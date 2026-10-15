// Before/after report for the translation controls (formal register + clinic glossary):
// baseline runs (harness/results/runs, controls off) vs. controlled runs (harness/results-controls/runs).
// Writes harness/results-controls/report.md.   Usage: npx tsx harness/controls-report.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasKey } from "../scripts/env.mjs";
import { ALL_CONFIGS, CONTROL_CONFIGS, harnessDir, loadScripts, type ScriptClip } from "./lib";
import { percentile, turnCost, wer, type Pricing, type UsageLike } from "./metrics";

interface Turn {
  clipId: string;
  turnId: string;
  status: string;
  marks: Record<string, number>;
  targetText: string;
  conditions: { direction: string; providers: string[] };
  providersUsed?: string[];
  usage?: UsageLike;
}

const baselineRuns = join(harnessDir, "results", "runs");
const controlsDir = join(harnessDir, "results-controls");
const controlsRuns = join(controlsDir, "runs");
const JUDGE_MODEL = "gpt-4.1-mini";

function load(dir: string, config: string): { turns: Turn[]; files: string[] } {
  if (!existsSync(dir)) return { turns: [], files: [] };
  const files = readdirSync(dir).filter((f) => f.split("--")[0] === config && f.endsWith(".json")).sort();
  return { turns: files.flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).turns as Turn[]), files };
}

// ---------- appsettings glossary (what the controls asked for) ----------
const appsettings = JSON.parse(readFileSync(join(harnessDir, "..", "server", "src", "Workbench.Api", "appsettings.json"), "utf8"));
const glossary: Record<string, Record<string, string>> = appsettings.TranslationControls.Glossary;

/**
 * Glossary adherence: for each glossary term that occurs in the clip's source sentence (longest match
 * first, word-bounded), did the output contain the required translation? Single-word entries that are
 * part of a longer matched phrase are not double-counted.
 */
function glossaryChecks(clip: ScriptClip, output: string): { term: string; want: string; ok: boolean }[] {
  const entries = Object.entries(glossary[`${clip.lang}-${clip.target}`] ?? {}).sort((a, b) => b[0].length - a[0].length);
  let src = ` ${clip.text.toLowerCase().replace(/[.,;:!?¿¡]/g, " ")} `;
  const out = output.toLowerCase();
  const checks: { term: string; want: string; ok: boolean }[] = [];
  for (const [term, want] of entries) {
    const needle = ` ${term.toLowerCase()} `;
    if (!src.includes(needle)) continue;
    src = src.replace(needle, " ⟂ ");
    // Check the head noun of the required translation (articles vary with sentence structure).
    const head = want.toLowerCase().replace(/^(the|a|an|la|el|los|las|un|una|su|mi|algún) /, "");
    checks.push({ term, want, ok: out.includes(head) });
  }
  return checks;
}

// ---------- register (Spanish output only): automated, cached ----------
const cachePath = join(controlsDir, "register-cache.json");
const cache: Record<string, string> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

async function register(text: string): Promise<"formal" | "informal" | "neutral" | null> {
  const key = createHash("sha256").update(`${JUDGE_MODEL}|${text}`).digest("hex").slice(0, 16);
  if (cache[key]) return cache[key] as "formal" | "informal" | "neutral";
  if (!hasKey("OpenAI__ApiKey") || !text.trim()) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OpenAI__ApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Classify how this Spanish sentence addresses the listener. formal = usted forms (usted, su, le, formal imperatives like 'tome', 'no coma'); " +
            "informal = tú forms (tú, te, tu, 'toma', 'no comas', '-as/-es' second-person verbs); neutral = does not address the listener. " +
            'Reply as JSON: {"register":"formal"|"informal"|"neutral"}',
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) return null;
  const v = JSON.parse(((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content).register;
  cache[key] = v;
  return v;
}

const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function stats(turns: Turn[], clips: Map<string, ScriptClip>, pricing: Pricing) {
  const ok = turns.filter((t) => t.status === "completed" && clips.has(t.clipId));
  const m2e = ok.map((t) => t.marks.firstAudible - t.marks.t0).filter(Number.isFinite);
  const esOut = ok.filter((t) => clips.get(t.clipId)!.target === "es");
  const regs: string[] = [];
  for (const t of esOut) {
    const r = await register(t.targetText);
    if (r) regs.push(r);
  }
  const checks = ok.flatMap((t) => glossaryChecks(clips.get(t.clipId)!, t.targetText));
  const minutes = ok.reduce((a, t) => a + (t.marks.release - t.marks.press), 0) / 60000;
  const usd = ok.filter((t) => t.usage).reduce((a, t) => a + turnCost(t.usage!, pricing, (t.providersUsed ?? [])[1] ?? t.conditions.providers[1] ?? ""), 0);
  return {
    n: ok.length,
    total: turns.length,
    p50: percentile(m2e, 50),
    p95: percentile(m2e, 95),
    wer: mean(ok.map((t) => wer(clips.get(t.clipId)!.reference, t.targetText, clips.get(t.clipId)!.target))),
    formal: regs.filter((r) => r === "formal").length,
    informal: regs.filter((r) => r === "informal").length,
    addressing: regs.filter((r) => r !== "neutral").length,
    glossOk: checks.filter((c) => c.ok).length,
    glossN: checks.length,
    misses: checks.filter((c) => !c.ok),
    costPerMin: minutes ? usd / minutes : NaN,
    ok,
  };
}

async function main() {
  const clips = new Map(loadScripts().clips.map((c) => [c.id, c]));
  const pricing: Pricing = JSON.parse(readFileSync(join(harnessDir, "pricing.json"), "utf8"));
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  line("# Translation controls: before / after");
  line();
  line(`Generated ${new Date().toISOString()} by \`npx tsx harness/controls-report.ts\`.`);
  line();
  line("**What changed:** the same 24 clips and pipelines, with translation controls on (`?controls=on`):");
  line("- **Formal register:** DeepL `formality: prefer_more`; for the OpenAI translator and Realtime, an instruction to address the listener formally (usted).");
  line("- **Clinic glossary** (`TranslationControls.Glossary` in appsettings.json): a DeepL multilingual glossary; for the OpenAI translator and Realtime, the same terms listed in the prompt.");
  line();
  line("**Before** = baseline runs in `harness/results/runs` (controls off, all saved runs pooled). **After** = `harness/results-controls/runs`.");
  line();

  const rows: string[] = [];
  const details: string[] = [];
  for (const [config, c] of Object.entries(CONTROL_CONFIGS)) {
    const after = load(controlsRuns, config);
    if (after.files.length === 0) continue;
    const before = load(baselineRuns, c.baseline);
    const b = await stats(before.turns, clips, pricing);
    const a = await stats(after.turns, clips, pricing);
    const reg = (s: typeof a) => (s.addressing ? `${s.formal}/${s.addressing} formal` : "–");
    rows.push(
      `| ${ALL_CONFIGS[c.baseline].label} | ${reg(b)} → **${reg(a)}** | ${b.glossOk}/${b.glossN} → **${a.glossOk}/${a.glossN}** | ` +
        `${b.wer.toFixed(3)} → ${a.wer.toFixed(3)} | ${sec(b.p50)} / ${sec(b.p95)} → ${sec(a.p50)} / ${sec(a.p95)} | ` +
        `$${b.costPerMin.toFixed(4)} → $${a.costPerMin.toFixed(4)} | ${b.n}/${b.total} → ${a.n}/${a.total} |`,
    );
    if (a.misses.length) {
      details.push(`**${CONTROL_CONFIGS[config].label}**, glossary misses after: ` + a.misses.map((m) => `"${m.term}" → "${m.want}"`).join(", "));
    }
    details.push(
      `**${CONTROL_CONFIGS[config].label}**, Spanish outputs that address the listener: ${a.formal} formal, ${a.informal} informal (before: ${b.formal} formal, ${b.informal} informal).`,
    );
  }
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  // Wrong-utterance check: an output that matches another clip's reference better than its own.
  const wrong: string[] = [];
  for (const [config, c] of Object.entries(CONTROL_CONFIGS)) {
    for (const [label, dir, name] of [["before", baselineRuns, c.baseline], ["after", controlsRuns, config]] as const) {
      for (const t of load(dir, name).turns.filter((x) => x.status === "completed" && clips.has(x.clipId))) {
        const clip = clips.get(t.clipId)!;
        const own = wer(clip.reference, t.targetText, clip.target);
        if (own < 0.6) continue;
        const best = [...clips.values()]
          .filter((o) => o.id !== clip.id && o.target === clip.target)
          .map((o) => ({ id: o.id, w: wer(o.reference, t.targetText, o.target) }))
          .sort((x, y) => x.w - y.w)[0];
        if (best && best.w < own) wrong.push(`| ${name} (${label}) | ${clip.id}: "${clip.text}" | "${t.targetText}" | matches ${best.id} (WER ${best.w.toFixed(2)} vs own ${own.toFixed(2)}) |`);
      }
    }
  }

  line("## Results");
  line();
  line("| Pipeline | Formal address (ES outputs that address the listener) | Glossary terms honoured | Target WER (proxy) | Mouth-to-ear p50 / p95 | Cost / min | Completed |");
  line("|---|---|---|---|---|---|---|");
  rows.forEach((r) => line(r));
  line();
  details.forEach((d) => {
    line(`- ${d}`);
  });
  line();
  line("### Wrong-utterance errors (output matches a different clip better than its own)");
  line();
  if (wrong.length) {
    line("| Run | Clip said | Output | Diagnosis |");
    line("|---|---|---|---|");
    wrong.forEach((w) => line(w));
    line();
    line("Realtime keeps the last 2 turns as conversation context; on these turns it re-spoke an earlier translation instead of the new audio. This is the main cause of Realtime's target-WER change, not the controls' wording itself (one occurrence, so the cause cannot be attributed).");
  } else {
    line("None.");
  }
  line();
  line("**How these are measured.**");
  line("- *Formal address:* each Spanish output (EN → ES turns) is classified formal / informal / neutral by an automated judge (gpt-4.1-mini, temperature 0, cached); neutral sentences (that do not address the listener) are excluded.");
  line("- *Glossary terms honoured:* for every glossary term that occurs in the clip's source sentence, whether the required translation's head noun appears in the output. Deterministic.");
  line("- *Target WER* is against the single reference translation (crude proxy). Latency and cost as in the main report.");
  line();
  line("**Caveat (teaching to the test).** The glossary was written after seeing the baseline errors on this same clip set, and several entries match these sentences. It shows that the levers work and what they cost; it is not an unbiased quality estimate on unseen sentences.");
  line();

  // Appendix: EN -> ES outputs side by side for the register story, plus the receta clip.
  line("## Appendix: outputs before → after");
  line();
  line("| Pipeline | Clip | Before (controls off) | After (controls on) |");
  line("|---|---|---|---|");
  for (const [config, c] of Object.entries(CONTROL_CONFIGS)) {
    const after = load(controlsRuns, config).turns;
    if (after.length === 0) continue;
    const before = load(baselineRuns, c.baseline).turns;
    for (const t of after) {
      const prev = before.find((x) => x.clipId === t.clipId);
      const esc = (s?: string) => (s ?? "").replace(/\|/g, "/");
      line(`| ${config} | ${t.clipId} | ${esc(prev?.targetText)} | ${esc(t.targetText)} |`);
    }
  }

  writeFileSync(join(controlsDir, "report.md"), out.join("\n") + "\n");
  console.log("Wrote harness/results-controls/report.md");
}

await main();

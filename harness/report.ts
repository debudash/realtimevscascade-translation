// npm run report: builds harness/results/report.md from the saved harness runs (latest run per
// configuration), the soak results, and an LLM "automated judge" rubric (cached; only new turns cost).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasKey } from "../scripts/env.mjs";
import { CONFIGS, ensureDir, loadScripts, resultsDir, runsDir, type ScriptClip } from "./lib";
import { answeredHeuristic, percentile, turnCost, wer, type Pricing, type UsageLike } from "./metrics";

interface Turn {
  clipId: string;
  turnId: string;
  status: string;
  marks: Record<string, number>;
  sourceText: string;
  targetText: string;
  conditions: { mode: string; strategy: string | null; direction: string; providers: string[] };
  providersUsed?: string[];
  usage?: UsageLike;
  failoverNote?: string;
  error?: { code: string; message: string };
}

interface Run {
  config: string;
  label: string;
  startedAt: string;
  turns: Turn[];
  file: string;
}

interface Verdict {
  accuracy: number;
  completeness: number;
  fluency: number;
  answered_instead_of_interpreted: boolean;
  note: string;
}

const JUDGE_MODEL = "gpt-4.1-mini";
const TARGETS: Record<string, number> = { realtime: 1500, "cascade-segment": 3000, "cascade-clause": 2000, "cascade-deepl": 3000 };
const STAGES: [string, string][] = [
  ["release", "Release"],
  ["sttFinal", "STT final"],
  ["translateFirstToken", "Translate 1st tok"],
  ["ttsFirstByte", "TTS first byte"],
  ["rtResponseStart", "RT response start"],
  ["firstAudible", "First audible"],
];

function latestRuns(): Run[] {
  if (!existsSync(runsDir)) return [];
  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort();
  const latest = new Map<string, string>();
  for (const f of files) latest.set(f.split("--")[0], f);
  return Object.keys(CONFIGS)
    .filter((c) => latest.has(c))
    .map((c) => ({ ...JSON.parse(readFileSync(join(runsDir, latest.get(c)!), "utf8")), file: latest.get(c)! }));
}

const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(2)} s`);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fix = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "–");

function since(t: Turn, mark: string, from = "t0"): number | null {
  const a = t.marks[mark];
  const b = t.marks[from];
  return a === undefined || b === undefined ? null : a - b;
}

function pp(values: (number | null)[]): string {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? `${sec(percentile(v, 50))} / ${sec(percentile(v, 95))}` : "–";
}

// ---------- automated judge (cached) ----------
const cachePath = join(resultsDir, "judge-cache.json");
const cache: Record<string, Verdict> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

async function judge(clip: ScriptClip, target: string): Promise<Verdict | null> {
  const key = createHash("sha256").update(`${JUDGE_MODEL}|${clip.id}|${target}`).digest("hex").slice(0, 16);
  if (cache[key]) return cache[key];
  if (!hasKey("OpenAI__ApiKey") || !target.trim()) return null;
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
            "You grade live interpretations in a medical clinic. Compare the CANDIDATE to the SOURCE utterance and the REFERENCE translation. " +
            "Score 1-5 (5 best): accuracy (meaning preserved, no errors), completeness (nothing omitted or added), fluency (natural target language). " +
            "Set answered_instead_of_interpreted=true if the candidate answers, comments on, or responds to the source instead of translating it. " +
            'Reply as JSON: {"accuracy":n,"completeness":n,"fluency":n,"answered_instead_of_interpreted":bool,"note":"<=15 words"}',
        },
        { role: "user", content: `SOURCE (${clip.lang}): ${clip.text}\nREFERENCE (${clip.target}): ${clip.reference}\nCANDIDATE (${clip.target}): ${target}` },
      ],
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  const v = JSON.parse(body.choices[0].message.content) as Verdict;
  cache[key] = v;
  return v;
}

// ---------- report ----------
async function main() {
  const runs = latestRuns();
  const scripts = loadScripts();
  const clipById = new Map(scripts.clips.map((c) => [c.id, c]));
  const pricing: Pricing = JSON.parse(readFileSync(join("harness", "pricing.json"), "utf8"));
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  if (runs.length === 0) {
    console.log("No harness runs found in harness/results/runs. Run the harness first (see harness/README.md).");
    return;
  }

  // Judge every turn (cached).
  const verdicts = new Map<string, Verdict | null>();
  for (const run of runs) {
    for (const t of run.turns) {
      const clip = clipById.get(t.clipId);
      if (clip && t.status === "completed") verdicts.set(`${run.config}|${t.clipId}`, await judge(clip, t.targetText));
    }
  }
  ensureDir(resultsDir);
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  line("# Evaluation report");
  line();
  line(`Generated ${new Date().toISOString()} by \`npm run report\` from the latest harness run per configuration.`);
  line("All numbers are measured; p50/p95 use linear interpolation. Clips are synthetic speech (ElevenLabs), 24 clinic sentences (12 EN, 12 ES).");
  line();
  line("| Configuration | Run file | Turns |");
  line("|---|---|---|");
  for (const r of runs) line(`| ${r.label} | \`runs/${r.file}\` | ${r.turns.length} |`);
  line();

  // Headline latency
  line("## 1. Latency: mouth-to-ear (T0 = last voiced frame → first audible)");
  line();
  line("| Configuration | n ok | p50 | p95 | Target | p95 meets target | Access p50 / p95 |");
  line("|---|---|---|---|---|---|---|");
  for (const r of runs) {
    const ok = r.turns.filter((t) => t.status === "completed");
    const m2e = ok.map((t) => since(t, "firstAudible")).filter((x): x is number => x !== null);
    const p95 = percentile(m2e, 95);
    const target = TARGETS[r.config];
    line(
      `| ${r.label} | ${ok.length}/${r.turns.length} | ${sec(percentile(m2e, 50))} | ${sec(p95)} | < ${(target / 1000).toFixed(1)} s` +
        `${r.config === "cascade-clause" ? " (stretch)" : ""} | ${p95 === null ? "–" : p95 < target ? "yes" : "no"} | ${pp(r.turns.map((t) => since(t, "access", "press")))} |`,
    );
  }
  line();
  line("Cascade target is < 3 s; the < 2 s stretch goal is shown against the clause configuration but applies to every cascade row.");
  line();

  line("### Stage breakdown (p50 / p95, ms after T0, completed turns)");
  line();
  line(`| Configuration | ${STAGES.map(([, l]) => l).join(" | ")} |`);
  line(`|---|${STAGES.map(() => "---").join("|")}|`);
  for (const r of runs) {
    const ok = r.turns.filter((t) => t.status === "completed");
    const cells = STAGES.map(([m]) =>
      r.config === "realtime" && ["sttFinal", "translateFirstToken", "ttsFirstByte"].includes(m)
        ? "hidden"
        : r.config !== "realtime" && m === "rtResponseStart"
          ? "n/a"
          : pp(ok.map((t) => since(t, m))),
    );
    line(`| ${r.label} | ${cells.join(" | ")} |`);
  }
  line();
  line("Cascade stage marks are when the final segment's stage event reached the browser; a negative value means the stage finished during speech (consecutive playback pre-synthesized it). Realtime's internal stages are not observable and are never estimated.");
  line();

  line("### By direction (mouth-to-ear p50 / p95)");
  line();
  line("| Configuration | EN → ES | ES → EN |");
  line("|---|---|---|");
  for (const r of runs) {
    const ok = r.turns.filter((t) => t.status === "completed");
    const dir = (d: string) => pp(ok.filter((t) => t.conditions.direction === d).map((t) => since(t, "firstAudible")));
    line(`| ${r.label} | ${dir("en-es")} | ${dir("es-en")} |`);
  }
  line();

  // Quality
  line("## 2. Quality");
  line();
  line("| Configuration | Source WER | Target WER vs reference (crude proxy) | Accuracy | Completeness | Fluency | Answered instead of interpreted |");
  line("|---|---|---|---|---|---|---|");
  const review: string[] = [];
  for (const r of runs) {
    const ok = r.turns.filter((t) => t.status === "completed" && clipById.has(t.clipId));
    const srcWer = mean(ok.map((t) => wer(clipById.get(t.clipId)!.text, t.sourceText, clipById.get(t.clipId)!.lang)));
    const tgtWer = mean(ok.map((t) => wer(clipById.get(t.clipId)!.reference, t.targetText, clipById.get(t.clipId)!.target)));
    const vs = ok.map((t) => verdicts.get(`${r.config}|${t.clipId}`)).filter((v): v is Verdict => !!v);
    let flagged = 0;
    for (const t of ok) {
      const clip = clipById.get(t.clipId)!;
      const h = answeredHeuristic({ target: t.targetText, reference: clip.reference, targetLang: clip.target, question: !!clip.question });
      const v = verdicts.get(`${r.config}|${t.clipId}`);
      if (v?.answered_instead_of_interpreted || h.flagged) {
        flagged++;
        const why = [...h.reasons, ...(v?.answered_instead_of_interpreted ? ["judge: answered"] : [])].join("; ");
        review.push(`| ${r.config} | ${t.clipId} | ${clip.text} | ${t.targetText} | ${why} |`);
      }
    }
    const srcLabel = r.config === "realtime" ? `${fix(srcWer, 3)} (side transcription)` : fix(srcWer, 3);
    line(
      `| ${r.label} | ${srcLabel} | ${fix(tgtWer, 3)} | ${fix(mean(vs.map((v) => v.accuracy)))} | ${fix(mean(vs.map((v) => v.completeness)))} | ` +
        `${fix(mean(vs.map((v) => v.fluency)))} | ${ok.length ? pct(flagged / ok.length) : "–"} (${flagged}/${ok.length}) |`,
    );
  }
  line();
  line(`Rubric scores are 1-5 from an **automated judge** (${JUDGE_MODEL}, temperature 0) comparing each output with the source and the reference translation; spot-check them with the human sheet in MORNING.md.`);
  line("Target WER against a single reference translation penalizes valid paraphrases, so it is a crude proxy. Realtime's source transcript comes from OpenAI's side transcription (gpt-4o-transcribe), not from what the speech-to-speech model understood.");
  line("\"Answered instead of interpreted\" = flagged by the heuristic (a question rendered as a statement, output > 1.8x the reference, or output in the wrong language) or by the judge. Flags are a review list, not a verdict.");
  line();
  if (review.length) {
    line("### Manual review list (flagged turns)");
    line();
    line("| Config | Clip | Source | Output | Why flagged |");
    line("|---|---|---|---|---|");
    review.forEach((r) => line(r));
    line();
  }

  // Cost
  line("## 3. Cost per minute of input speech");
  line();
  line(`Logged usage per turn × \`harness/pricing.json\` (prices read ${pricing.verifiedOn}; marked "verify"; DeepL rate UNVERIFIED).`);
  line();
  line("| Configuration | Speech minutes | Total USD | USD per minute |");
  line("|---|---|---|---|");
  for (const r of runs) {
    const ok = r.turns.filter((t) => t.usage);
    const minutes = ok.reduce((a, t) => a + ((t.marks.release ?? 0) - (t.marks.press ?? 0)), 0) / 60000;
    const usd = ok.reduce((a, t) => a + turnCost(t.usage!, pricing, (t.providersUsed ?? [])[1] ?? t.conditions.providers[1] ?? ""), 0);
    line(`| ${r.label} | ${minutes.toFixed(2)} | ${usd.toFixed(4)} | ${minutes ? (usd / minutes).toFixed(4) : "–"} |`);
  }
  line();
  line("Speech minutes = press-to-release time of the turns. Realtime cost includes model audio/text tokens (input context re-billing included as logged) and side transcription; cascade = Deepgram minutes + translation tokens or characters + ElevenLabs characters.");
  line();

  // Provider swap
  const seg = runs.find((r) => r.config === "cascade-segment");
  const deepl = runs.find((r) => r.config === "cascade-deepl");
  line("## 4. Provider flexibility: OpenAI → DeepL translation swap");
  line();
  if (seg && deepl) {
    const stats = (r: Run) => {
      const ok = r.turns.filter((t) => t.status === "completed");
      return {
        m2e: pp(ok.map((t) => since(t, "firstAudible"))),
        tok: pp(ok.map((t) => (t.marks.translateFirstToken !== undefined ? since(t, "translateFirstToken") : null))),
        wer: fix(mean(ok.filter((t) => clipById.has(t.clipId)).map((t) => wer(clipById.get(t.clipId)!.reference, t.targetText, clipById.get(t.clipId)!.target)))),
        acc: fix(mean(ok.map((t) => verdicts.get(`${r.config}|${t.clipId}`)?.accuracy ?? NaN).filter(Number.isFinite))),
      };
    };
    const a = stats(seg);
    const b = stats(deepl);
    line("| | OpenAI (gpt-4.1-nano, streamed) | DeepL (no streaming) |");
    line("|---|---|---|");
    line(`| Mouth-to-ear p50 / p95 | ${a.m2e} | ${b.m2e} |`);
    line(`| Translate first token, after T0 | ${a.tok} | ${b.tok} |`);
    line(`| Target WER (proxy) | ${a.wer} | ${b.wer} |`);
    line(`| Judge accuracy | ${a.acc} | ${b.acc} |`);
    line();
    line("The swap is a configuration change only: the harness opens `/?providers=translation:deepl`; no code changed. The same is true server-side via `Providers:Translation` in appsettings.json.");
  } else {
    line("Not yet run.");
  }
  line();

  // Soak
  line("## 5. Stability: 5-minute soak per mode");
  line();
  const soaks = ["realtime", "cascade"].map((m) => ({ m, path: join(resultsDir, `soak-${m}.json`) })).filter((s) => existsSync(s.path));
  if (soaks.length) {
    line("| Mode | Minutes | Turns | Failed turns | Unplanned disconnects | Forced-drop recovery (drop → Ready) | Transcript intact after drop | Heap start → end | Max playback buffer |");
    line("|---|---|---|---|---|---|---|---|---|");
    for (const { m, path } of soaks) {
      const s = JSON.parse(readFileSync(path, "utf8"));
      const mb = (b: number | null) => (b ? `${(b / 1048576).toFixed(1)} MB` : "–");
      const unplanned = Math.max(0, s.disconnects - (s.forcedDrop ? 1 : 0));
      const intact = s.forcedDrop ? (s.forcedDrop.turnsAfter >= s.forcedDrop.turnsBefore ? "yes" : "no") : "–";
      line(
        `| ${m} | ${s.minutes} | ${s.turns} | ${s.turnErrors} | ${unplanned} | ${s.forcedDrop?.recoveryMs ?? "–"} ms | ${intact} | ` +
          `${mb(s.heapStartBytes)} → ${mb(s.heapEndBytes)} | ${s.maxBufferedSamples ? `${(s.maxBufferedSamples / 24).toFixed(0)} ms` : "0 ms"} |`,
      );
    }
  } else {
    line("Not yet run.");
  }
  line();

  line("## 6. Time to onboard a language pair");
  line();
  line(existsSync(join(resultsDir, "onboarding.md")) ? "See [onboarding.md](onboarding.md)." : "Not yet run.");
  line();

  // Appendix
  line("## Appendix: every turn");
  line();
  line("| Config | Clip | Status | Mouth-to-ear | Source (as heard) | Target |");
  line("|---|---|---|---|---|---|");
  for (const r of runs) {
    for (const t of r.turns) {
      const esc = (s: string) => (s ?? "").replace(/\|/g, "/");
      line(`| ${r.config} | ${t.clipId} | ${t.status}${t.error ? ` (${t.error.code})` : ""} | ${sec(since(t, "firstAudible"))} | ${esc(t.sourceText)} | ${esc(t.targetText)} |`);
    }
  }

  writeFileSync(join(resultsDir, "report.md"), out.join("\n") + "\n");
  console.log(`Wrote harness/results/report.md (${runs.length} configurations).`);
}

await main();

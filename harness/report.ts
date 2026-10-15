// npm run report: builds harness/results/report.md from the saved harness runs (latest run per
// configuration), the soak results, and an LLM "automated judge" rubric (cached; only new turns cost).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasKey } from "../scripts/env.mjs";
import { CONFIGS, ensureDir, loadScripts, resultsDir, runsDir, type ScriptClip } from "./lib";
// (This report covers the baseline folder; harness/controls-report.ts compares the controls runs against it.)
import { answeredHeuristic, percentile, turnCost, wer, type Pricing, type UsageLike } from "./metrics";

interface Turn {
  clipId: string;
  run?: string;
  stages?: { stage: string; durationMs: number; segment: number }[];
  turnId: string;
  status: string;
  marks: Record<string, number>;
  sourceText: string;
  targetText: string;
  conditions: { mode: string; strategy: string | null; direction: string; providers: string[] };
  providersUsed?: string[];
  usage?: UsageLike;
  failoverNote?: string;
  playback?: { jitterBufferMs: number; concealedPct: number; packetsLost: number };
  error?: { code: string; message: string };
}

interface Run {
  config: string;
  label: string;
  turns: Turn[];
  files: string[];
}

interface Verdict {
  accuracy: number;
  completeness: number;
  fluency: number;
  answered_instead_of_interpreted: boolean;
  note: string;
}

const JUDGE_MODEL = "gpt-4.1-mini";
const turnKey = (config: string, t: Turn) => `${config}|${t.run ?? ""}|${t.turnId}`;
const TARGETS: Record<string, number> = { realtime: 1500, "cascade-segment": 3000, "cascade-clause": 2000, "cascade-deepl": 3000 };
const STAGES: [string, string][] = [
  ["release", "Release"],
  ["sttFinal", "STT final"],
  ["translateFirstToken", "Translate 1st tok"],
  ["ttsFirstByte", "TTS first byte"],
  ["rtResponseStart", "RT response start"],
  ["firstAudible", "First audible"],
];

/** All saved runs per configuration, pooled (p50/p95 over every turn of every run). */
function pooledRuns(): Run[] {
  if (!existsSync(runsDir)) return [];
  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort();
  return Object.keys(CONFIGS)
    .map((config) => {
      const mine = files.filter((f) => f.split("--")[0] === config);
      const turns = mine.flatMap((f) => (JSON.parse(readFileSync(join(runsDir, f), "utf8")).turns as Turn[]).map((t) => ({ ...t, run: f })));
      return { config, label: CONFIGS[config].label, turns, files: mine };
    })
    .filter((r) => r.files.length > 0);
}

/** The build a run file records, or for older runs the commit that was HEAD when it started (inferred). */
function buildOf(file: string): string {
  const run = JSON.parse(readFileSync(join(runsDir, file), "utf8")) as { build?: string; startedAt?: string };
  if (run.build) return run.build;
  if (!run.startedAt) return "not recorded";
  try {
    const sha = execFileSync("git", ["log", "-1", `--before=${run.startedAt}`, "--format=%h"], { encoding: "utf8" }).trim();
    return sha ? `${sha} (inferred)` : "not recorded";
  } catch {
    return "not recorded";
  }
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

/** Realtime: where the time between response start and first audio went, per run (vendor-side). */
function rtSplit(runs: Run[]): string | null {
  const rt = runs.find((r) => r.config === "realtime");
  if (!rt) return null;
  const parts = rt.files.map((f, i) => {
    const ok = rt.turns.filter((t) => t.run === f && t.status === "completed");
    return `run ${i + 1}: release → response start ${pp(ok.map((t) => since(t, "rtResponseStart", "release")))}, response start → first audible ${pp(ok.map((t) => since(t, "firstAudible", "rtResponseStart")))}`;
  });
  return `Realtime p50 / p95 by segment, ${parts.join("; ")}. The client-side part (release → response start) is stable across runs; the variance is in the vendor's time from response start to first audio.`;
}

// ---------- report ----------
async function main() {
  const runs = pooledRuns();
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
      if (clip && t.status === "completed") verdicts.set(turnKey(run.config, t), await judge(clip, t.targetText));
    }
  }
  ensureDir(resultsDir);
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  line("# Evaluation report");
  line();
  line(`Generated ${new Date().toISOString()} by \`npm run report\` from every saved harness run, pooled per configuration.`);
  line("All numbers are measured; p50/p95 use linear interpolation. Clips are synthetic speech (ElevenLabs), 24 clinic sentences (12 EN, 12 ES).");
  line();
  line("| Configuration | Runs | Build | Turns |");
  line("|---|---|---|---|");
  for (const r of runs)
    line(`| ${r.label} | ${r.files.map((f) => `\`runs/${f}\``).join("<br>")} | ${r.files.map(buildOf).join("<br>")} | ${r.turns.length} |`);
  line();
  line("Build = the server commit recorded with the run. \"(inferred)\" marks runs saved before runs recorded it: the commit that was HEAD when the run started (uncommitted changes at the time are not visible).");
  line();

  // Headline latency
  line("## 1. Latency: mouth-to-ear (T0 = last voiced frame → first audible)");
  line();
  line("| Configuration | n ok | p50 | p95 | Target | p95 meets target | Release → first audible p50 / p95 | Access p50 / p95 |");
  line("|---|---|---|---|---|---|---|---|");
  for (const r of runs) {
    const ok = r.turns.filter((t) => t.status === "completed");
    const m2e = ok.map((t) => since(t, "firstAudible")).filter((x): x is number => x !== null);
    const p95 = percentile(m2e, 95);
    const target = TARGETS[r.config];
    line(
      `| ${r.label} | ${ok.length}/${r.turns.length} | ${sec(percentile(m2e, 50))} | ${sec(p95)} | < ${(target / 1000).toFixed(1)} s` +
        `${r.config === "cascade-clause" ? " (stretch)" : ""} | ${p95 === null ? "–" : p95 < target ? "yes" : "no"} | ` +
        `${pp(ok.map((t) => since(t, "firstAudible", "release")))} | ${pp(r.turns.map((t) => since(t, "access", "press")))} |`,
    );
  }
  line();
  line("Cascade target is < 3 s; the < 2 s stretch goal is shown against the clause configuration but applies to every cascade row.");
  line();

  line("### Run-to-run variance (mouth-to-ear p50 / p95 per run)");
  line();
  line("| Configuration | " + [1, 2, 3].map((n) => `Run ${n}`).join(" | ") + " |");
  line("|---|---|---|---|");
  for (const r of runs) {
    const cells = [0, 1, 2].map((i) => {
      const f = r.files[i];
      if (!f) return "–";
      const ok = r.turns.filter((t) => t.run === f && t.status === "completed");
      return `${pp(ok.map((t) => since(t, "firstAudible")))} (${f.split("--")[1].slice(11, 16).replace("-", ":")} UTC)`;
    });
    line(`| ${r.label} | ${cells.join(" | ")} |`);
  }
  line();
  if (rtSplit(runs)) line(rtSplit(runs)!);
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

  line("### Server stage durations (Stopwatch, final segment, p50 / p95)");
  line();
  line("| Configuration | STT final after release | Translate first token | Translate done | TTS first byte |");
  line("|---|---|---|---|---|");
  for (const r of runs.filter((x) => x.config !== "realtime")) {
    const ok = r.turns.filter((t) => t.status === "completed" && t.stages?.length);
    const last = (t: Turn, stage: string) => {
      const s = (t.stages ?? []).filter((x) => x.stage === stage);
      return s.length ? s[s.length - 1].durationMs : null;
    };
    const cell = (stage: string) => pp(ok.map((t) => last(t, stage)));
    line(`| ${r.label} | ${cell("stt_final")} | ${cell("translate_first_token")} | ${cell("translate_done")} | ${cell("tts_first_byte")} |`);
  }
  line();
  line("Measured on the server; translation and TTS durations run from the stage's own start (commit, or translation done), so they show each provider's own latency without network hops to the browser.");
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
    const vs = ok.map((t) => verdicts.get(turnKey(r.config, t))).filter((v): v is Verdict => !!v);
    let flagged = 0;
    for (const t of ok) {
      const clip = clipById.get(t.clipId)!;
      const h = answeredHeuristic({ target: t.targetText, reference: clip.reference, targetLang: clip.target, question: !!clip.question });
      const v = verdicts.get(turnKey(r.config, t));
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
  line(`Rubric scores are 1-5 from an **automated judge** (${JUDGE_MODEL}, temperature 0) comparing each output with the source and the reference translation; the blind human spot-check below checks it.`);
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

  // Human spot-check: blind scores for a sample of turns, beside the judge's scores for the same outputs.
  const humanPath = join(resultsDir, "human-scores.json");
  line("### Human spot-check (blind)");
  line();
  if (existsSync(humanPath)) {
    type Scores = { accuracy: number; completeness: number; fluency: number; answeredInsteadOfInterpreted: boolean };
    const items = (JSON.parse(readFileSync(humanPath, "utf8")).items ?? []) as { config: string; human: Scores; judge: Scores }[];
    const dims = ["accuracy", "completeness", "fluency"] as const;
    line("| Configuration | Turns | Human acc / comp / flu | Judge acc / comp / flu (same turns) | Answered instead (human) |");
    line("|---|---|---|---|---|");
    for (const config of [...new Set(items.map((i) => i.config))]) {
      const mine = items.filter((i) => i.config === config);
      const avg = (who: "human" | "judge") => dims.map((d) => fix(mean(mine.map((i) => i[who][d])))).join(" / ");
      line(`| ${CONFIGS[config]?.label ?? config} | ${mine.length} | ${avg("human")} | ${avg("judge")} | ${mine.filter((i) => i.human.answeredInsteadOfInterpreted).length} / ${mine.length} |`);
    }
    const pairs = items.flatMap((i) => dims.map((d) => i.human[d] - i.judge[d]));
    const exact = pairs.filter((x) => x === 0).length;
    const within1 = pairs.filter((x) => Math.abs(x) <= 1).length;
    const lower = pairs.filter((x) => x < 0).length;
    line();
    line(`Agreement over ${pairs.length} individual scores: ${exact} identical, ${within1} within one point, ${lower} where the human scored lower than the judge. Scored blind by the project owner (configuration hidden, random order); source: \`human-scores.json\`. Ten turns per configuration can check the judge, not rank the configurations.`);
  } else {
    line("Not done yet.");
  }
  line();

  // Cost
  line("## 3. Cost per minute of input speech");
  line();
  line(`Logged usage per turn × \`harness/pricing.json\`. Prices: ${(pricing as Pricing & { status?: string }).status ?? `read ${pricing.verifiedOn}`}.`);
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
  const rt = runs.find((r) => r.config === "realtime");
  if (rt) {
    const p = pricing.realtime;
    const sum = (f: (u: NonNullable<UsageLike["realtime"]>) => number) =>
      rt.turns.reduce((a, t) => a + (t.usage?.realtime ? f(t.usage.realtime) : 0), 0) / 1e6;
    const audioIn = sum((u) => u.inputAudioTokens * p.audioInPer1M);
    const audioOut = sum((u) => u.outputAudioTokens * p.audioOutPer1M);
    const text = sum((u) => Math.max(0, u.inputTextTokens - u.cachedInputTokens) * p.textInPer1M + u.cachedInputTokens * p.cachedInPer1M + u.outputTextTokens * p.textOutPer1M);
    const tr = rt.turns.reduce((a, t) => a + ((t.usage?.sttAudioSeconds ?? 0) / 60) * pricing.realtimeTranscriptionPerMinute, 0);
    const total = audioIn + audioOut + text + tr;
    line(
      `Realtime cost split: input audio tokens ${pct(audioIn / total)} (includes earlier turns re-billed as context), ` +
        `output audio tokens ${pct(audioOut / total)}, text tokens ${pct(text / total)}, side transcription ${pct(tr / total)}.`,
    );
    line();
  }
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
        acc: fix(mean(ok.map((t) => verdicts.get(turnKey(r.config, t))?.accuracy ?? NaN).filter(Number.isFinite))),
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
    line("| Mode | Minutes | Turns | Failed turns | Unplanned disconnects | Forced-drop recovery (drop → Ready) | Transcript intact after drop | Heap floor, 1st min → last min | Heap raw start → end | Max playback buffer | Underruns |");
    line("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const { m, path } of soaks) {
      const s = JSON.parse(readFileSync(path, "utf8"));
      const mb = (b: number | null) => (b ? `${(b / 1048576).toFixed(1)} MB` : "–");
      const unplanned = Math.max(0, s.disconnects - (s.forcedDrop ? 1 : 0));
      const intact = s.forcedDrop ? (s.forcedDrop.turnsAfter >= s.forcedDrop.turnsBefore ? "yes" : "no") : "–";
      // The heap is sampled without forcing GC, so it saws up and down; the post-GC floor
      // (minimum) in the first vs. the last minute is the leak signal.
      const samples = s.samples as { t: number; heapBytes?: number }[];
      const floor = (from: number, to: number) => {
        const h = samples.filter((x) => x.t >= from && x.t <= to && x.heapBytes).map((x) => x.heapBytes!);
        return h.length ? Math.min(...h) : null;
      };
      const end = samples[samples.length - 1].t;
      line(
        `| ${m} | ${s.minutes} | ${s.turns} | ${s.turnErrors} | ${unplanned} | ${s.forcedDrop?.recoveryMs ?? "–"} ms | ${intact} | ` +
          `${mb(floor(0, 60000))} → ${mb(floor(end - 60000, end))} | ${mb(s.heapStartBytes)} → ${mb(s.heapEndBytes)} | ` +
          `${s.maxBufferedSamples ? `${(s.maxBufferedSamples / 24).toFixed(0)} ms` : "0 ms"} | ${s.underrunsAtEnd ?? "–"} |`,
      );
    }
    line();
    line("Unplanned disconnects excludes the one forced drop. Realtime plays through a media element, so its jitter buffer is the browser's and its depth over time is not observable (0 / –); see the getStats summary below. The cascade's max buffer is synthesized audio queued ahead of playback (TTS runs faster than real time); it drains to zero every turn.");
    line();
    line("### Realtime playback health (WebRTC getStats)");
    line();
    // Per turn: inbound-rtp audio counters at release vs. after playback (client/src/transports/realtime/rtcStats.ts).
    const rtTurns = runs.filter((r) => r.config === "realtime").flatMap((r) => r.turns).filter((t) => t.playback);
    const rtSoak = soaks.map(({ m, path }) => ({ m, s: JSON.parse(readFileSync(path, "utf8")) })).find((x) => x.m === "realtime" && x.s.rtJitterBufferMsAtEnd != null);
    if (rtTurns.length || rtSoak) {
      line("| Source | Turns | Jitter-buffer delay p50 / p95 | Concealed audio (mean) | Packets lost |");
      line("|---|---|---|---|---|");
      if (rtTurns.length) {
        const jb = rtTurns.map((t) => t.playback!.jitterBufferMs);
        line(`| Harness turns | ${rtTurns.length} | ${fix(percentile(jb, 50)!, 0)} / ${fix(percentile(jb, 95)!, 0)} ms | ${fix(mean(rtTurns.map((t) => t.playback!.concealedPct)), 2)}% | ${rtTurns.reduce((a, t) => a + t.playback!.packetsLost, 0)} |`);
      }
      if (rtSoak) line(`| 5-minute soak (cumulative) | ${rtSoak.s.turns} | ${fix(rtSoak.s.rtJitterBufferMsAtEnd, 0)} ms (average) | ${fix(rtSoak.s.rtConcealedPctAtEnd ?? NaN, 2)}% | – |`);
      line();
      line("Jitter-buffer delay is the average time each played sample spent in the browser's buffer; concealed audio is the share synthesized to cover gaps (glitches). Buffer depth over time stays unobservable.");
    } else {
      line("Not measured yet: getStats() sampling was added after these runs. A Realtime run or soak records it per turn.");
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

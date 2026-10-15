// Test Runs: the setups a run can use, the estimate shown before Start, and the summary and
// comparison of saved runs. Pure functions (unit-tested in testRun.test.ts); the runner and the
// tab live in TestRunner.ts and ui/TestRuns.tsx.

import { accessMs, mouthToEarMs, percentile, type MarkName, type TurnRecord } from "../state/metrics";
import { wer } from "../state/wer";
import type { Setup } from "./controller";

export type SetupKey = "realtime" | "cascade-segment" | "cascade-clause" | "cascade-deepl";

export interface SetupInfo {
  label: string;
  detail: string;
  /** p95 mouth-to-ear target: brief targets, with the 2 s stretch for the clause optimization. */
  targetMs: number;
  setup(controls: boolean): Setup;
}

/** The four configurations the evaluation measures; a Test Run uses exactly one. */
export const SETUPS: Record<SetupKey, SetupInfo> = {
  realtime: { label: "Realtime", detail: "gpt-realtime over WebRTC", targetMs: 1500, setup: (controls) => ({ mode: "realtime", strategy: "segment", controls }) },
  "cascade-segment": { label: "Cascade · segment", detail: "Deepgram → OpenAI gpt-4.1-nano → ElevenLabs", targetMs: 3000, setup: (controls) => ({ mode: "cascade", strategy: "segment", controls }) },
  "cascade-clause": { label: "Cascade · clause", detail: "same providers, clause commits", targetMs: 2000, setup: (controls) => ({ mode: "cascade", strategy: "clause", controls }) },
  "cascade-deepl": {
    label: "Cascade · DeepL",
    detail: "Deepgram → DeepL → ElevenLabs",
    targetMs: 3000,
    setup: (controls) => ({ mode: "cascade", strategy: "segment", controls, providers: { translation: "deepl" } }),
  },
};

export interface PlannedClip {
  id: string;
  lang: string;
  target: string;
  text: string;
  reference: string;
  durationSeconds: number;
}

/** Automated release after a replay clip ends (controller REPLAY_TAIL_MS). */
const RELEASE_TAIL_S = 0.25;
/** Per-turn time beyond the clip: interpretation playback, settling, plus the gap between turns. */
const TURN_OVERHEAD_S = 2.5;

export interface Estimate {
  turns: number;
  /** Press-to-release seconds: what the measured cost per minute is based on. */
  voicedSeconds: number;
  /** Null when the setup has no measured rate yet. */
  usd: number | null;
  /** Wall-clock seconds, approximate. */
  seconds: number;
}

export function estimate(clips: PlannedClip[], passes: number, usdPerMinute: number | null): Estimate {
  const voicedPerPass = clips.reduce((a, c) => a + c.durationSeconds + RELEASE_TAIL_S, 0);
  const voicedSeconds = voicedPerPass * passes;
  const seconds = clips.reduce((a, c) => a + 2 * c.durationSeconds + TURN_OVERHEAD_S, 0) * passes;
  return { turns: clips.length * passes, voicedSeconds, usd: usdPerMinute === null ? null : (voicedSeconds / 60) * usdPerMinute, seconds };
}

export interface TestRunSummary {
  turns: number;
  completed: number;
  failed: number;
  p50Ms: number | null;
  p95Ms: number | null;
  targetMs: number;
  meetsTarget: boolean | null;
  accessP50Ms: number | null;
  releaseToAudibleP50Ms: number | null;
  /** p50 ms after T0 per mark, completed turns. */
  stageP50Ms: Partial<Record<MarkName, number>>;
  /** Mean word error rate of the source transcript vs the clip text. */
  sourceWer: number | null;
  /** Mean WER of the interpretation vs the reference translation (a crude proxy). */
  targetWer: number | null;
  costUsd: number | null;
  voicedMinutes: number;
  usdPerMinute: number | null;
}

const STAGE_MARKS: MarkName[] = ["release", "sttFinal", "translateFirstToken", "translateDone", "ttsFirstByte", "rtResponseStart", "firstAudible"];
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null) => (x === null ? null : Math.round(x));

/** `costOf` prices one turn (the tab passes turnCost with the pricing table); omit it to skip cost. */
export function summarizeRun(turns: TurnRecord[], clips: Record<string, PlannedClip>, setupKey: SetupKey, costOf?: (t: TurnRecord) => number | null): TestRunSummary {
  const done = turns.filter((t) => t.status === "completed");
  const m2e = nums(done.map(mouthToEarMs));
  const p95 = percentile(m2e, 95);
  const targetMs = SETUPS[setupKey].targetMs;
  const stageP50Ms: Partial<Record<MarkName, number>> = {};
  for (const m of STAGE_MARKS) {
    const v = percentile(nums(done.map((t) => (t.marks[m] !== undefined && t.marks.t0 !== undefined ? t.marks[m]! - t.marks.t0 : null))), 50);
    if (v !== null) stageP50Ms[m] = Math.round(v);
  }
  const sourceWer = mean(nums(done.map((t) => (clips[t.conditions.inputSource] && t.sourceText ? wer(clips[t.conditions.inputSource].text, t.sourceText, clips[t.conditions.inputSource].lang) : null))));
  const targetWer = mean(
    nums(done.map((t) => (clips[t.conditions.inputSource] && t.targetText ? wer(clips[t.conditions.inputSource].reference, t.targetText, clips[t.conditions.inputSource].target) : null))),
  );
  const costs = costOf ? nums(turns.map(costOf)) : [];
  const costUsd = costOf && costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  const voicedMinutes = turns.reduce((a, t) => a + (t.marks.release !== undefined && t.marks.press !== undefined ? t.marks.release - t.marks.press : 0), 0) / 60000;
  return {
    turns: turns.length,
    completed: done.length,
    failed: turns.length - done.length,
    p50Ms: round(percentile(m2e, 50)),
    p95Ms: round(p95),
    targetMs,
    meetsTarget: p95 === null ? null : p95 < targetMs,
    accessP50Ms: round(percentile(nums(done.map(accessMs)), 50)),
    releaseToAudibleP50Ms: round(percentile(nums(done.map((t) => (t.marks.firstAudible !== undefined && t.marks.release !== undefined ? t.marks.firstAudible - t.marks.release : null))), 50)),
    stageP50Ms,
    sourceWer: sourceWer === null ? null : Number(sourceWer.toFixed(3)),
    targetWer: targetWer === null ? null : Number(targetWer.toFixed(3)),
    costUsd,
    voicedMinutes,
    usdPerMinute: costUsd !== null && voicedMinutes > 0 ? costUsd / voicedMinutes : null,
  };
}

export interface ClipDelta {
  clip: string;
  aMs: number;
  bMs: number;
  /** B minus A: positive means B was slower. */
  deltaMs: number;
}

/** Per clip present in both runs: mean mouth-to-ear of each run's completed turns, and B minus A. */
export function compareRuns(a: TurnRecord[], b: TurnRecord[]): ClipDelta[] {
  const byClip = (turns: TurnRecord[]) => {
    const m = new Map<string, number[]>();
    for (const t of turns) {
      const v = t.status === "completed" ? mouthToEarMs(t) : null;
      if (v === null) continue;
      m.set(t.conditions.inputSource, [...(m.get(t.conditions.inputSource) ?? []), v]);
    }
    return m;
  };
  const ma = byClip(a);
  const mb = byClip(b);
  return [...ma.keys()]
    .filter((k) => mb.has(k))
    .sort()
    .map((clip) => {
      const aMs = Math.round(mean(ma.get(clip)!)!);
      const bMs = Math.round(mean(mb.get(clip)!)!);
      return { clip, aMs, bMs, deltaMs: bMs - aMs };
    });
}

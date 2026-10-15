import { describe, expect, it } from "vitest";
import type { TurnRecord } from "../state/metrics";
import { compareRuns, estimate, SETUPS, summarizeRun, type PlannedClip } from "./testRun";

const clips: Record<string, PlannedClip> = {
  "en-01": { id: "en-01", lang: "en", target: "es", text: "My son has had a fever since last night.", reference: "Mi hijo tiene fiebre desde anoche.", durationSeconds: 2.5 },
  "es-01": { id: "es-01", lang: "es", target: "en", text: "Tengo una cita a las tres.", reference: "I have an appointment at three.", durationSeconds: 1.5 },
};

function turn(clip: string, o: { t0: number; first?: number; status?: TurnRecord["status"]; source?: string; target?: string; mode?: "realtime" | "cascade" }): TurnRecord {
  return {
    turnId: `${clip}-${o.t0}`,
    speaker: clips[clip].lang,
    conditions: { mode: o.mode ?? "cascade", strategy: "segment", providers: ["deepgram", "openai", "elevenlabs"], pair: "en-es", direction: `${clips[clip].lang}-${clips[clip].target}`, inputSource: clip },
    startedAtIso: "2026-10-15T12:00:00.000Z",
    marks: { press: o.t0 - 2600, access: o.t0 - 2580, t0: o.t0, release: o.t0 + 400, ...(o.first !== undefined ? { firstAudible: o.first } : {}) },
    stages: [],
    sourceText: o.source ?? clips[clip].text,
    targetText: o.target ?? clips[clip].reference,
    status: o.status ?? "completed",
    usage: { sttAudioSeconds: 3, translationInputTokens: 0, translationOutputTokens: 0, translationCharacters: 0, ttsCharacters: 0 },
  };
}

describe("SETUPS", () => {
  it("offers exactly the four measured configurations, each a single mode", () => {
    expect(Object.keys(SETUPS)).toEqual(["realtime", "cascade-segment", "cascade-clause", "cascade-deepl"]);
    expect(SETUPS.realtime.setup(true)).toMatchObject({ mode: "realtime", controls: true });
    expect(SETUPS["cascade-clause"].setup(false)).toMatchObject({ mode: "cascade", strategy: "clause", controls: false });
    expect(SETUPS["cascade-deepl"].setup(false).providers).toEqual({ translation: "deepl" });
  });
});

describe("estimate", () => {
  it("prices press-to-release minutes at the measured rate and counts passes", () => {
    // (2.5 + 0.25) + (1.5 + 0.25) = 4.5 s per pass, 2 passes = 9 s = 0.15 min at $0.20/min = $0.03.
    const e = estimate([clips["en-01"], clips["es-01"]], 2, 0.2);
    expect(e.turns).toBe(4);
    expect(e.voicedSeconds).toBeCloseTo(9, 5);
    expect(e.usd).toBeCloseTo(0.03, 5);
    expect(e.seconds).toBeGreaterThan(e.voicedSeconds);
  });

  it("has no cost when the setup has no measured rate yet", () => {
    expect(estimate([clips["en-01"]], 1, null).usd).toBeNull();
  });
});

describe("summarizeRun", () => {
  it("summarizes completed turns against the setup's target, with WER from the clip texts", () => {
    const turns = [
      turn("en-01", { t0: 10_000, first: 11_000 }),
      turn("es-01", { t0: 20_000, first: 22_000, source: "Tengo una cita a las tres", target: "I have an appointment at 3." }),
      turn("en-01", { t0: 30_000, status: "failed" }),
    ];
    const s = summarizeRun(turns, clips, "cascade-segment");
    expect(s.turns).toBe(3);
    expect(s.completed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.p50Ms).toBe(1500);
    expect(s.p95Ms).toBe(1950);
    expect(s.targetMs).toBe(3000);
    expect(s.meetsTarget).toBe(true);
    expect(s.accessP50Ms).toBe(20);
    expect(s.releaseToAudibleP50Ms).toBe(1100);
    expect(s.sourceWer).toBe(0); // punctuation and "3" vs "three" normalize away
    expect(s.targetWer).toBe(0);
  });

  it("holds the clause setup to the 2 s stretch target", () => {
    const s = summarizeRun([turn("en-01", { t0: 0, first: 2100 })], clips, "cascade-clause");
    expect(s.targetMs).toBe(2000);
    expect(s.meetsTarget).toBe(false);
  });
});

describe("compareRuns", () => {
  it("pairs clips present in both runs and reports the per-clip mean difference (B minus A)", () => {
    const a = [turn("en-01", { t0: 0, first: 1000, mode: "realtime" }), turn("en-01", { t0: 10_000, first: 11_200, mode: "realtime" }), turn("es-01", { t0: 20_000, first: 21_000, mode: "realtime" })];
    const b = [turn("en-01", { t0: 0, first: 1500 })];
    expect(compareRuns(a, b)).toEqual([{ clip: "en-01", aMs: 1100, bMs: 1500, deltaMs: 400 }]);
  });
});

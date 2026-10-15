import { describe, expect, it } from "vitest";
import { MetricsStore, accessMs, mouthToEarMs, percentile, summarize, type RunConditions } from "./metrics";

const cascade: RunConditions = {
  mode: "cascade",
  strategy: "segment",
  providers: ["deepgram", "openai", "elevenlabs"],
  pair: "en-es",
  direction: "en-es",
  inputSource: "mic",
};

describe("percentile", () => {
  it("interpolates like numpy's default", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("MetricsStore", () => {
  it("records every mark per turn with run conditions, first write wins", () => {
    const m = new MetricsStore();
    m.startTurn("t1", "en", cascade, 100);
    m.mark("t1", "access", 130);
    m.mark("t1", "access", 999);
    m.setMark("t1", "t0", 1800);
    m.mark("t1", "release", 2000);
    m.mark("t1", "firstAudible", 2900);
    const t = m.get("t1")!;
    expect(t.marks).toEqual({ press: 100, access: 130, t0: 1800, release: 2000, firstAudible: 2900 });
    expect(t.conditions).toEqual(cascade);
    expect(mouthToEarMs(t)).toBe(1100);
    expect(accessMs(t)).toBe(30);
  });

  it("stage marks follow the latest segment (the waterfall shows the final segment)", () => {
    const m = new MetricsStore();
    m.startTurn("t1", "en", cascade, 0);
    m.stage("t1", { stage: "tts_first_byte", durationMs: 200, segment: 0, provider: "elevenlabs", receivedAt: 500 });
    m.stage("t1", { stage: "tts_first_byte", durationMs: 180, segment: 1, provider: "elevenlabs", receivedAt: 2500 });
    expect(m.get("t1")!.marks.ttsFirstByte).toBe(2500);
    expect(m.get("t1")!.stages).toHaveLength(2);
  });

  it("summarizes completed turns per configuration against targets", () => {
    const m = new MetricsStore();
    [900, 1100, 1300].forEach((d, i) => {
      const id = `t${i}`;
      m.startTurn(id, "en", cascade, 0);
      m.setMark(id, "t0", 1000);
      m.mark(id, "firstAudible", 1000 + d);
      m.update(id, { status: "completed" });
    });
    m.startTurn("failed", "en", cascade, 0);
    m.update("failed", { status: "failed" });

    const seg = summarize(m.all()).find((s) => s.key === "cascade-segment")!;
    expect(seg.n).toBe(3);
    expect(seg.p50).toBe(1100);
    expect(seg.meetsTarget).toBe(true);
    expect(summarize(m.all()).find((s) => s.key === "realtime")!.meetsTarget).toBeNull();
  });

  it("exports JSON with derived latencies", () => {
    const m = new MetricsStore();
    m.startTurn("t1", "es", { ...cascade, direction: "es-en" }, 10);
    m.mark("t1", "access", 40);
    const parsed = JSON.parse(m.export());
    expect(parsed.turns[0].accessMs).toBe(30);
    expect(parsed.turns[0].conditions.direction).toBe("es-en");
  });
});

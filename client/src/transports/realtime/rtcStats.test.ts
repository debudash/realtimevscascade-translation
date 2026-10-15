import { describe, expect, it } from "vitest";
import { playbackStatsBetween, readInboundAudio } from "./rtcStats";

function report(entries: Record<string, unknown>[]): RTCStatsReport {
  return new Map(entries.map((e, i) => [String(i), e])) as unknown as RTCStatsReport;
}

const inbound = (o: Partial<Record<string, number>>) => ({
  type: "inbound-rtp",
  kind: "audio",
  jitterBufferDelay: 0,
  jitterBufferEmittedCount: 0,
  concealedSamples: 0,
  totalSamplesReceived: 0,
  packetsLost: 0,
  ...o,
});

describe("readInboundAudio", () => {
  it("reads the inbound audio counters and ignores video and outbound entries", () => {
    const r = report([
      { type: "outbound-rtp", kind: "audio", packetsSent: 10 },
      { type: "inbound-rtp", kind: "video", jitterBufferDelay: 99 },
      inbound({ jitterBufferDelay: 2.4, jitterBufferEmittedCount: 48000, concealedSamples: 480, totalSamplesReceived: 48000, packetsLost: 1 }),
    ]);
    expect(readInboundAudio(r)).toEqual({
      jitterBufferDelay: 2.4,
      jitterBufferEmittedCount: 48000,
      concealedSamples: 480,
      totalSamplesReceived: 48000,
      packetsLost: 1,
    });
  });

  it("is null when there is no inbound audio yet", () => {
    expect(readInboundAudio(report([{ type: "transport" }]))).toBeNull();
  });
});

describe("playbackStatsBetween", () => {
  it("averages the jitter-buffer delay over the samples emitted in the interval", () => {
    const a = { jitterBufferDelay: 2400, jitterBufferEmittedCount: 48000, concealedSamples: 100, totalSamplesReceived: 48000, packetsLost: 0 };
    // jitterBufferDelay sums each sample's delay in seconds: 1200 s over 24,000 samples -> 50 ms average.
    const b = { jitterBufferDelay: 3600, jitterBufferEmittedCount: 72000, concealedSamples: 340, totalSamplesReceived: 72000, packetsLost: 2 };
    expect(playbackStatsBetween(a, b)).toEqual({ jitterBufferMs: 50, concealedPct: 1, packetsLost: 2 });
  });

  it("is null when nothing was played in the interval", () => {
    const a = { jitterBufferDelay: 1, jitterBufferEmittedCount: 100, concealedSamples: 0, totalSamplesReceived: 100, packetsLost: 0 };
    expect(playbackStatsBetween(a, { ...a })).toBeNull();
  });

  it("treats a counter reset (new peer connection) as a fresh start", () => {
    const before = { jitterBufferDelay: 5, jitterBufferEmittedCount: 96000, concealedSamples: 50, totalSamplesReceived: 96000, packetsLost: 3 };
    const after = { jitterBufferDelay: 480, jitterBufferEmittedCount: 9600, concealedSamples: 0, totalSamplesReceived: 9600, packetsLost: 0 };
    expect(playbackStatsBetween(before, after)).toEqual({ jitterBufferMs: 50, concealedPct: 0, packetsLost: 0 });
  });
});

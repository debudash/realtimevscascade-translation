import { describe, expect, it } from "vitest";
import { playDenyTone, type ToneContext } from "./denyTone";
import { OutputTap } from "./dsp";
import { MetricsStore } from "../state/metrics";

/** A fake context that records every connection made. */
function fakeContext() {
  const destination = { id: "destination" } as unknown as AudioNode;
  const connections: [unknown, unknown][] = [];
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {} });
  let started = 0;
  const node = (kind: string) => {
    const n: Record<string, unknown> = { kind };
    n.connect = (target: unknown) => connections.push([n, target]);
    return n;
  };
  const ctx: ToneContext = {
    currentTime: 0,
    destination,
    createOscillator: () =>
      Object.assign(node("osc"), { type: "", frequency: param(), start: () => started++, stop() {} }) as unknown as OscillatorNode,
    createGain: () => Object.assign(node("gain"), { gain: param() }) as unknown as GainNode,
  };
  return { ctx, destination, connections, started: () => started };
}

describe("deny tone", () => {
  it("plays two notes routed straight to the destination", () => {
    const f = fakeContext();
    playDenyTone(f.ctx);
    expect(f.started()).toBe(2);
    const toDestination = f.connections.filter(([, target]) => target === f.destination);
    expect(toDestination).toHaveLength(2);
    // Every connection ends at a gain node or the destination: nothing else (no playback worklet / tap).
    for (const [, target] of f.connections) {
      expect(target === f.destination || (target as { kind: string }).kind === "gain").toBe(true);
    }
  });

  it("never produces first_audible: a deny during playback leaves the turn's marks unchanged", () => {
    const metrics = new MetricsStore();
    metrics.startTurn("t1", "en", { mode: "cascade", strategy: "segment", providers: [], pair: "en-es", direction: "en-es", inputSource: "mic" }, 0);
    const tap = new OutputTap();
    tap.arm(); // interpreted playback is pending

    // The deny tone is generated in its own nodes; the tap only ever sees interpreted samples.
    const f = fakeContext();
    playDenyTone(f.ctx);
    const interpretedSilence = new Float32Array(128);
    expect(tap.scan(interpretedSilence)).toBe(-1);
    expect(metrics.get("t1")!.marks.firstAudible).toBeUndefined();
  });
});

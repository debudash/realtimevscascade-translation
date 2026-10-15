import { describe, expect, it } from "vitest";
import { Framer, OutputTap, Resampler, RingBuffer, floatToInt16, int16ToFloat, rmsDbfs } from "./dsp";
import { EnergyDetector } from "./energyDetector";

function sine(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
}

function frameOf(amp: number): Int16Array {
  return Int16Array.from({ length: 320 }, (_, i) => floatToInt16(amp * Math.sin(i / 3)));
}

describe("Resampler", () => {
  it("produces 16 kHz output from 48 kHz input at the right length across chunk boundaries", () => {
    const r = new Resampler(48000, 16000);
    const input = sine(440, 48000, 1);
    let total = 0;
    for (let i = 0; i < input.length; i += 128) total += r.process(input.subarray(i, i + 128)).length;
    expect(Math.abs(total - 16000)).toBeLessThanOrEqual(2);
  });

  it("handles a non-integer ratio (44.1 kHz)", () => {
    const r = new Resampler(44100, 16000);
    let total = 0;
    const input = sine(300, 44100, 1);
    for (let i = 0; i < input.length; i += 128) total += r.process(input.subarray(i, i + 128)).length;
    expect(Math.abs(total - 16000)).toBeLessThanOrEqual(2);
  });

  it("keeps a speech-band tone's level", () => {
    const out = new Resampler(48000, 16000).process(sine(300, 48000, 0.5, 0.5));
    const peak = Math.max(...out.slice(1000).map(Math.abs));
    expect(peak).toBeGreaterThan(0.4);
  });
});

describe("Framer", () => {
  it("emits 20 ms PCM16 frames and carries the remainder", () => {
    const f = new Framer(320);
    expect(f.push(new Float32Array(300))).toHaveLength(0);
    const frames = f.push(new Float32Array(400));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveLength(320);
    expect(f.lastEndOffsets).toEqual([20, 340]); // 300 carried + 20 completes frame 1
  });

  it("clips and converts to int16", () => {
    expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(-2)).toBe(-32768);
    expect(int16ToFloat(Int16Array.of(-32768))[0]).toBe(-1);
  });
});

describe("rmsDbfs", () => {
  it("is -Infinity for silence and about -9 dBFS for a 0.5 sine", () => {
    expect(rmsDbfs(new Int16Array(320))).toBe(-Infinity);
    const s = Int16Array.from(sine(1000, 16000, 0.02, 0.5), floatToInt16);
    expect(rmsDbfs(s)).toBeCloseTo(-9, 0);
  });
});

describe("RingBuffer", () => {
  it("wraps, reports length, and reports overflow", () => {
    const rb = new RingBuffer(4);
    expect(rb.write(Float32Array.of(1, 2, 3))).toBe(0);
    const out = new Float32Array(2);
    expect(rb.read(out)).toBe(2);
    expect([...out]).toEqual([1, 2]);
    expect(rb.write(Float32Array.of(4, 5, 6, 7))).toBe(1);
    expect(rb.length).toBe(4);
    const all = new Float32Array(8);
    expect(rb.read(all)).toBe(4);
    expect([...all.slice(0, 4)]).toEqual([3, 4, 5, 6]);
  });
});

describe("OutputTap", () => {
  it("fires once per arm on the first sample over threshold", () => {
    const tap = new OutputTap(0.01);
    expect(tap.scan(Float32Array.of(0.5))).toBe(-1); // not armed
    tap.arm();
    expect(tap.scan(Float32Array.of(0, 0.001, 0.02, 0.5))).toBe(2);
    expect(tap.scan(Float32Array.of(0.9))).toBe(-1); // already fired
  });

  it("ignores silence and only reads the first n samples", () => {
    const tap = new OutputTap(0.01);
    tap.arm();
    expect(tap.scan(Float32Array.of(0, 0, 0.5), 2)).toBe(-1);
    expect(tap.isArmed).toBe(true);
  });
});

describe("EnergyDetector", () => {
  const loud = frameOf(0.3);
  const quiet = new Int16Array(320);

  it("emits speech start after two voiced frames, and T0 is the end of the last voiced frame", () => {
    const d = new EnergyDetector();
    const seq = [quiet, loud, loud, loud, quiet, quiet];
    const events = seq.flatMap((f, i) => d.push(f, i * 20, 20));
    expect(events).toEqual([{ type: "speech_start", t: 20 }]);
    expect(d.lastVoicedEnd).toBe(80); // frame 3 ends at 80 ms
  });

  it("emits speech end after the hangover, stamped at the last voiced frame", () => {
    const d = new EnergyDetector();
    const seq = [loud, loud, ...Array(20).fill(quiet)];
    const events = seq.flatMap((f, i) => d.push(f, i * 20, 20));
    expect(events).toEqual([
      { type: "speech_start", t: 0 },
      { type: "speech_end", t: 40 },
    ]);
  });

  it("ignores a single click", () => {
    const d = new EnergyDetector();
    const events = [quiet, loud, quiet, quiet].flatMap((f, i) => d.push(f, i * 20, 20));
    expect(events).toEqual([]);
    expect(d.lastVoicedEnd).toBeNull();
  });

  it("keeps the latest voiced frame across a mid-utterance pause", () => {
    const d = new EnergyDetector();
    const seq = [loud, loud, ...Array(20).fill(quiet), loud, loud, loud, quiet];
    seq.forEach((f, i) => d.push(f, i * 20, 20));
    expect(d.lastVoicedEnd).toBe(25 * 20);
    expect(d.speechStart).toBe(0);
  });
});

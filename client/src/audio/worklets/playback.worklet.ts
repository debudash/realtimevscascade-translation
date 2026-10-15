/// <reference path="./worklet-env.d.ts" />
// PlaybackWorklet: a jitter buffer for interpreted audio, plus the OutputTap that marks first_audible.
// Messages in:  { type: "push", samples: Float32Array } | { type: "play" } | { type: "end" } | { type: "reset" }
// Messages out: { type: "first_audible", ctxTime } | { type: "started" } | { type: "drained" } | { type: "depth", samples, underruns }
import { OutputTap, RingBuffer } from "../dsp";

const JITTER_MS = 60;
const DEPTH_REPORT_EVERY_S = 0.5;

type InMsg = { type: "push"; samples: Float32Array } | { type: "play" } | { type: "end" } | { type: "reset" };

class PlaybackProcessor extends AudioWorkletProcessor {
  private readonly buffer = new RingBuffer(sampleRate * 120);
  private readonly tap = new OutputTap(0.01);
  private playRequested = false;
  private started = false;
  private ended = false;
  private underruns = 0;
  private lastDepthReport = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InMsg>) => {
      const m = e.data;
      if (m.type === "push") this.buffer.write(m.samples);
      else if (m.type === "play") {
        this.playRequested = true;
        this.tap.arm();
      } else if (m.type === "end") this.ended = true;
      else if (m.type === "reset") {
        this.buffer.clear();
        this.playRequested = this.started = this.ended = false;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0][0];
    out.fill(0);

    if (this.playRequested && !this.started) {
      // Consecutive playback: start once the jitter buffer holds enough, or the turn's audio is complete.
      if (this.buffer.length >= (JITTER_MS / 1000) * sampleRate || (this.ended && this.buffer.length > 0)) {
        this.started = true;
        this.port.postMessage({ type: "started" });
      } else if (this.ended && this.buffer.length === 0) {
        this.finish();
      }
    }

    if (this.started) {
      const n = this.buffer.read(out);
      if (n < out.length && !this.ended) this.underruns++;
      const hit = this.tap.scan(out, n);
      if (hit >= 0) this.port.postMessage({ type: "first_audible", ctxTime: currentTime + hit / sampleRate });
      if (this.ended && this.buffer.length === 0) this.finish();
    }

    if (currentTime - this.lastDepthReport >= DEPTH_REPORT_EVERY_S) {
      this.lastDepthReport = currentTime;
      this.port.postMessage({ type: "depth", samples: this.buffer.length, underruns: this.underruns });
    }

    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }

  private finish(): void {
    this.playRequested = this.started = this.ended = false;
    this.port.postMessage({ type: "drained" });
  }
}

registerProcessor("playback-processor", PlaybackProcessor);

import playbackWorkletUrl from "./worklets/playback.worklet.ts?worker&url";
import { ctxTimeToPerf } from "./clock";
import { Resampler, int16ToFloat } from "./dsp";
import { playDenyTone } from "./denyTone";

export const PLAYBACK_RATE = 24000;

/**
 * Cascade playback: PCM16 chunks -> PlaybackWorklet (jitter buffer + OutputTap) -> speakers.
 * Audio is buffered until play() (consecutive playback starts on button release).
 * The deny tone uses this context's destination directly and never passes through the worklet.
 */
export class Player {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private ready: Promise<void> | null = null;
  private resamplers = new Map<number, Resampler>();

  onFirstAudible: (perfMs: number) => void = () => {};
  onStarted: () => void = () => {};
  onDrained: () => void = () => {};
  /** Latest jitter-buffer depth report (for the soak test). */
  depth = { samples: 0, underruns: 0 };

  constructor() {
    this.ctx = new AudioContext({ sampleRate: PLAYBACK_RATE, latencyHint: "interactive" });
  }

  init(): Promise<void> {
    this.ready ??= (async () => {
      await this.ctx.audioWorklet.addModule(playbackWorkletUrl);
      this.node = new AudioWorkletNode(this.ctx, "playback-processor", { outputChannelCount: [1] });
      this.node.port.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === "first_audible") this.onFirstAudible(ctxTimeToPerf(this.ctx, m.ctxTime));
        else if (m.type === "started") this.onStarted();
        else if (m.type === "drained") this.onDrained();
        else if (m.type === "depth") this.depth = { samples: m.samples, underruns: m.underruns };
      };
      this.node.connect(this.ctx.destination);
    })();
    return this.ready;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  push(pcm: Int16Array, sampleRate: number): void {
    let samples = int16ToFloat(pcm);
    if (sampleRate !== this.ctx.sampleRate) {
      let r = this.resamplers.get(sampleRate);
      if (!r) this.resamplers.set(sampleRate, (r = new Resampler(sampleRate, this.ctx.sampleRate)));
      samples = r.process(samples);
    }
    this.node?.port.postMessage({ type: "push", samples }, [samples.buffer]);
  }

  /** Start playing (arms the OutputTap). */
  play(): void {
    this.node?.port.postMessage({ type: "play" });
  }

  /** No more audio for this turn; the worklet reports drained when the buffer empties. */
  end(): void {
    this.node?.port.postMessage({ type: "end" });
  }

  reset(): void {
    this.resamplers.clear();
    this.node?.port.postMessage({ type: "reset" });
  }

  denyTone(): void {
    playDenyTone(this.ctx);
  }

  async close(): Promise<void> {
    await this.ctx.close();
  }
}

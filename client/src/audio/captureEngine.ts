import captureWorkletUrl from "./worklets/capture.worklet.ts?worker&url";
import { ctxTimeToPerf } from "./clock";

export class MicDeniedError extends Error {
  constructor(message = "Microphone access is blocked") {
    super(message);
    this.name = "MicDeniedError";
  }
}

export interface CapturedFrame {
  pcm: Int16Array;
  /** Browser-clock ms of the frame's first and last sample. */
  startMs: number;
  endMs: number;
}

const FRAME_MS = 20;

/**
 * The capture graph shared by both modes:
 *   input (mic | replay WAV) -> PTT gate -> CaptureWorklet (PCM16 16 kHz frames for cascade + energy detector)
 *                                        -> MediaStreamDestination (the track Realtime sends over WebRTC)
 * The gate is closed unless a speaker holds the floor, so capture is muted during playback.
 */
export class CaptureEngine {
  readonly ctx: AudioContext;
  private readonly gate: GainNode;
  private readonly streamDest: MediaStreamAudioDestinationNode;
  private worklet: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private replaySource: AudioBufferSourceNode | null = null;
  private ready: Promise<void> | null = null;

  onFrame: (frame: CapturedFrame) => void = () => {};

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.gate = this.ctx.createGain();
    this.gate.gain.value = 0;
    this.streamDest = this.ctx.createMediaStreamDestination();
    this.gate.connect(this.streamDest);
  }

  init(): Promise<void> {
    this.ready ??= (async () => {
      await this.ctx.audioWorklet.addModule(captureWorkletUrl);
      this.worklet = new AudioWorkletNode(this.ctx, "capture-processor", { numberOfOutputs: 1 });
      this.worklet.port.onmessage = (e: MessageEvent<{ pcm: Int16Array; ctxEnd: number }>) => {
        const endMs = ctxTimeToPerf(this.ctx, e.data.ctxEnd);
        this.onFrame({ pcm: e.data.pcm, startMs: endMs - FRAME_MS, endMs });
      };
      // Keep the worklet pulled by the graph without making it audible.
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.gate.connect(this.worklet);
      this.worklet.connect(sink);
      sink.connect(this.ctx.destination);
    })();
    return this.ready;
  }

  /** Browsers start contexts suspended until a user gesture. */
  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** The gated capture track, sent to OpenAI in Realtime mode. */
  get track(): MediaStreamTrack {
    return this.streamDest.stream.getAudioTracks()[0];
  }

  async useMic(): Promise<void> {
    if (this.micSource) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === "NotAllowedError" || name === "SecurityError" || name === "NotFoundError") throw new MicDeniedError();
      throw e;
    }
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.gate);
  }

  releaseMic(): void {
    this.micSource?.disconnect();
    this.micSource = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  async loadClip(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Clip ${url} returned ${res.status}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  /** Plays a replay clip through the same capture path. Resolves when the clip ends. */
  playClip(buffer: AudioBuffer): Promise<void> {
    this.stopClip();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gate);
    this.replaySource = src;
    return new Promise((resolve) => {
      src.onended = () => {
        src.disconnect();
        if (this.replaySource === src) this.replaySource = null;
        resolve();
      };
      src.start();
    });
  }

  stopClip(): void {
    try {
      this.replaySource?.stop();
    } catch {
      /* already stopped */
    }
  }

  /** PTT gate. A 5 ms ramp avoids clicks. */
  setGate(open: boolean): void {
    const g = this.gate.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(open ? 1 : 0, now + 0.005);
  }

  async close(): Promise<void> {
    this.releaseMic();
    await this.ctx.close();
  }
}

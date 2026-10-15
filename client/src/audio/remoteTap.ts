/**
 * Realtime mode's first_audible: an AnalyserNode on the remote WebRTC track, polled every 5 ms
 * after arm(). Playback itself goes through an <audio> element (Chrome only pulls remote
 * WebRTC audio into Web Audio reliably when the stream is also attached to a media element).
 */
export class RemoteAudioTap {
  private readonly ctx: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly buf: Float32Array<ArrayBuffer>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private quietSince: number | null = null;

  onFirstAudible: (perfMs: number) => void = () => {};
  /** Fires after `silenceMs` of silence following audible output (fallback end-of-playback signal). */
  onSilence: (perfMs: number) => void = () => {};

  constructor(
    stream: MediaStream,
    readonly threshold = 0.01,
    readonly silenceMs = 700,
  ) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** Current peak level (0..1), for the level bar. */
  peak(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let max = 0;
    for (let i = 0; i < this.buf.length; i++) max = Math.max(max, Math.abs(this.buf[i]));
    return max;
  }

  arm(): void {
    this.disarm();
    let heard = false;
    this.quietSince = null;
    this.timer = setInterval(() => {
      const now = performance.now();
      const loud = this.peak() >= this.threshold;
      if (!heard && loud) {
        heard = true;
        this.onFirstAudible(now);
      } else if (heard) {
        if (loud) this.quietSince = null;
        else if (this.quietSince === null) this.quietSince = now;
        else if (now - this.quietSince >= this.silenceMs) {
          this.disarm();
          this.onSilence(now);
        }
      }
    }, 5);
  }

  disarm(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async close(): Promise<void> {
    this.disarm();
    await this.ctx.close();
  }
}

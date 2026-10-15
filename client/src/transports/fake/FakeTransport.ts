import type { WorkbenchEvent } from "../../contracts/events";
import type { Player } from "../../audio/player";
import type { InterpreterTransport, TransportSink, TurnSpec } from "../types";

/**
 * Client-only simulated transport (`?transport=fake`). No backend, no keys, no cost.
 * Used to develop and test the audio engine, floor control and UI before the real
 * transports exist, and in e2e tests of client behaviour.
 */
export class FakeTransport implements InterpreterTransport {
  readonly mode = "cascade" as const;
  readonly kind = "Simulated";
  private turns = new Map<string, { spec: TurnSpec; frames: number; accessSent: boolean }>();
  private t0 = performance.now();

  constructor(
    private readonly sink: TransportSink,
    private readonly player: Player,
  ) {
    player.onStarted = () => this.current && sink.playbackStarted(this.current);
    player.onDrained = () => this.current && sink.playbackEnded(this.current);
    player.onFirstAudible = (t) => this.current && sink.mark(this.current, "firstAudible", t);
  }

  private current: string | null = null;

  private emit(e: WorkbenchEvent): void {
    this.sink.event({ ...e, t: performance.now() - this.t0 } as WorkbenchEvent, performance.now());
  }

  async connect(): Promise<void> {
    this.sink.connection("Connecting");
    await this.player.init();
    await new Promise((r) => setTimeout(r, 150));
    this.sink.connection("Connected");
    this.emit({
      type: "session.ready",
      t: 0,
      mode: "cascade",
      strategy: "segment",
      providers: { stt: "fake", translation: "fake", translationFallback: "fake", tts: "fake" },
    });
  }

  startTurn(spec: TurnSpec): void {
    this.current = spec.turnId;
    this.player.reset();
    this.turns.set(spec.turnId, { spec, frames: 0, accessSent: false });
    this.emit({ type: "turn.start", turnId: spec.turnId, t: 0, speaker: spec.speaker, direction: `${spec.source}-${spec.target}` });
  }

  sendFrame(turnId: string, _pcm: Int16Array): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    if (!turn.accessSent) {
      turn.accessSent = true;
      this.sink.mark(turnId, "access", performance.now());
    }
    turn.frames++;
    if (turn.frames % 25 === 0) {
      const text = `simulated ${turn.spec.source} speech ${turn.frames / 25}`;
      this.emit({ type: "source.partial", turnId, t: 0, text, lang: turn.spec.source, stable: "" });
    }
  }

  release(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    this.player.play();
    const dir = `${turn.spec.source}-${turn.spec.target}`;
    setTimeout(() => {
      const seconds = (turn.frames * 0.02).toFixed(1);
      this.emit({ type: "source.final", turnId, t: 0, text: `Simulated ${seconds} s of ${turn.spec.source}.`, lang: turn.spec.source });
      this.emit({ type: "target.final", turnId, t: 0, text: `Simulated ${turn.spec.target} interpretation.`, lang: turn.spec.target });
      // 400 ms of a 330 Hz tone as the "interpretation".
      const n = 24000 * 0.4;
      const pcm = Int16Array.from({ length: n }, (_, i) => Math.round(6000 * Math.sin((2 * Math.PI * 330 * i) / 24000)));
      this.player.push(pcm, 24000);
      this.player.end();
      this.emit({ type: "turn.end", turnId, t: 0, speaker: turn.spec.speaker, direction: dir, status: turn.frames > 0 ? "completed" : "empty" });
    }, 300);
  }

  cancel(turnId: string): void {
    this.turns.delete(turnId);
    this.player.reset();
  }

  async close(): Promise<void> {
    this.sink.connection("Closed");
  }

  diagnostics(): Record<string, number> {
    return { ...this.player.depth };
  }
}

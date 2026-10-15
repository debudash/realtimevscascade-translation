// Cascade mode: the browser streams PCM16 16 kHz mono frames over WebSocket /ws/cascade; the
// server streams normalized events and synthesized audio back (STT -> translation -> TTS run on
// the server). Audio is buffered until release (consecutive playback), then played immediately.

import { base64ToInt16 } from "../../audio/dsp";
import type { Player } from "../../audio/player";
import { parseEvent, type WorkbenchEvent } from "../../contracts/events";
import type { InterpreterTransport, TransportOptions, TransportSink, TurnSpec } from "../types";

const MAX_RECONNECTS = 5;
const READY_TIMEOUT_MS = 15000;

export class CascadeTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class CascadeTransport implements InterpreterTransport {
  readonly mode = "cascade" as const;
  readonly kind = "WebSocket";
  private ws: WebSocket | null = null;
  private current: TurnSpec | null = null;
  private accessSent = false;
  private released = false;
  private closed = false;
  private reconnecting = false;
  private pendingReady: { resolve: () => void; reject: (e: Error) => void } | null = null;

  constructor(
    private readonly sink: TransportSink,
    private readonly player: Player,
    private readonly opts: TransportOptions,
    private readonly faults?: Record<string, string>,
  ) {
    player.onStarted = () => this.current && sink.playbackStarted(this.current.turnId);
    player.onDrained = () => this.current && sink.playbackEnded(this.current.turnId);
    player.onFirstAudible = (t) => this.current && sink.mark(this.current.turnId, "firstAudible", t);
  }

  async connect(): Promise<void> {
    this.sink.connection("Connecting");
    await this.open();
    this.sink.connection("Connected");
  }

  /** Opens the socket, configures the session, and resolves on session.ready (server providers warm). */
  private open(): Promise<void> {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/cascade`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    const ready = new Promise<void>((resolve, reject) => {
      this.pendingReady = { resolve, reject };
      setTimeout(() => reject(new CascadeTransportError("provider_timeout", "Cascade warm-up timed out")), READY_TIMEOUT_MS);
    });

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "session.configure",
          pairId: this.opts.pairId,
          strategy: this.opts.strategy,
          providers: this.opts.providers,
          faults: this.faults,
        }),
      );
    };
    ws.onmessage = (e) => this.onMessage(e.data as string);
    ws.onclose = () => {
      if (ws !== this.ws) return;
      if (this.pendingReady) {
        this.pendingReady.reject(new CascadeTransportError("socket_drop", "Cascade socket closed during warm-up"));
        this.pendingReady = null;
      } else if (!this.closed) {
        void this.reconnect();
      }
    };
    return ready;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;
    // The turn in progress is cancelled by the controller (Error state); drop its audio.
    this.player.reset();
    this.current = null;
    for (let attempt = 1; attempt <= MAX_RECONNECTS && !this.closed; attempt++) {
      this.sink.connection("Reconnecting", attempt, MAX_RECONNECTS);
      await new Promise((r) => setTimeout(r, Math.min(4000, 500 * 2 ** (attempt - 1))));
      try {
        await this.open();
        this.reconnecting = false;
        this.sink.connection("Connected");
        return;
      } catch {
        this.ws?.close();
      }
    }
    this.reconnecting = false;
    if (!this.closed) this.sink.connection("Failed");
  }

  private onMessage(data: string): void {
    let e: WorkbenchEvent;
    try {
      e = parseEvent(data);
    } catch {
      return;
    }
    const now = performance.now();

    if (e.type === "session.ready") {
      this.pendingReady?.resolve();
      this.pendingReady = null;
    } else if (e.type === "error" && !e.turnId && this.pendingReady) {
      // Configuration failures arrive before session.ready.
      this.pendingReady.reject(new CascadeTransportError(e.code, e.message));
      this.pendingReady = null;
      return;
    }

    // Drop anything from a turn that is no longer current (cancelled, or before a reconnect).
    if (e.turnId && e.turnId !== this.current?.turnId) return;

    if (e.type === "audio.chunk") {
      this.player.push(base64ToInt16(e.data), e.sampleRate);
    } else if (e.type === "turn.end") {
      this.player.end();
    }
    this.sink.event(e, now);
  }

  startTurn(spec: TurnSpec): void {
    this.current = spec;
    this.accessSent = false;
    this.released = false;
    this.player.reset();
    this.send({ type: "turn.start", turnId: spec.turnId, speaker: spec.speaker, source: spec.source, target: spec.target });
  }

  sendFrame(turnId: string, pcm: Int16Array): void {
    if (this.current?.turnId !== turnId || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm as Int16Array<ArrayBuffer>); // frames come from the worklet, never shared memory
    if (!this.accessSent) {
      // Access time: the first frame accepted by the transport.
      this.accessSent = true;
      this.sink.mark(turnId, "access", performance.now());
    }
  }

  release(turnId: string): void {
    if (this.current?.turnId !== turnId || this.released) return;
    this.released = true;
    this.send({ type: "turn.release", turnId });
    // Consecutive playback: anything synthesized during speech starts playing now.
    this.player.play();
  }

  cancel(turnId: string): void {
    if (this.current?.turnId !== turnId) return;
    this.send({ type: "turn.cancel", turnId });
    this.player.reset();
    this.current = null;
  }

  private send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Soak-test hook: drop the socket to measure recovery. */
  forceDrop(): void {
    this.ws?.close(4000, "forced drop");
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.close(1000, "closed");
    this.ws = null;
    this.sink.connection("Closed");
  }

  diagnostics(): Record<string, number> {
    return { bufferedSamples: this.player.depth.samples, underruns: this.player.depth.underruns };
  }
}

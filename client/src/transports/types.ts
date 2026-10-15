import type { WorkbenchEvent } from "../contracts/events";
import type { PlaybackStats } from "./realtime/rtcStats";
import type { MarkName, Strategy } from "../state/metrics";
import type { Mode } from "../state/turnMachine";

export type ConnectionState = "Connecting" | "Connected" | "Reconnecting" | "Failed" | "Closed";

export interface TurnSpec {
  turnId: string;
  speaker: string;
  source: string;
  target: string;
}

export interface TransportOptions {
  pairId: string;
  strategy: Strategy;
  /** Per-session provider override, e.g. { translation: "deepl" } or all "fake". */
  providers?: Record<string, string>;
  /** The gated capture track (Realtime sends it over WebRTC). */
  captureTrack: MediaStreamTrack;
  /** Translation controls (formal register + glossary); undefined = server default. */
  controls?: boolean;
}

/**
 * What a transport reports back. The UI layer only ever sees normalized events and these
 * mode-agnostic signals; it never knows whether audio came over WebRTC or WebSocket.
 */
export interface TransportSink {
  event(e: WorkbenchEvent, receivedAt: number): void;
  connection(state: ConnectionState, attempt?: number, maxAttempts?: number): void;
  /** Browser-clock marks the transport owns: access, rtResponseStart, firstAudible. */
  mark(turnId: string, name: MarkName, perfMs: number): void;
  playbackStarted(turnId: string): void;
  /** Always fires once per released turn, even when nothing was played. */
  playbackEnded(turnId: string): void;
  /** Realtime only: WebRTC jitter-buffer delay and concealment for the turn's playback (may arrive after playbackEnded). */
  playbackStats?(turnId: string, stats: PlaybackStats): void;
}

/** One interface, two implementations (Realtime over WebRTC, Cascade over WebSocket). */
export interface InterpreterTransport {
  readonly mode: Mode;
  /** Human label for the connection pill, e.g. "WebRTC". */
  readonly kind: string;
  /** Warm-up: open connections (and have the server warm providers). Resolves when ready. */
  connect(): Promise<void>;
  startTurn(turn: TurnSpec): void;
  /** Cascade sends PCM16 frames; Realtime ignores them (its audio goes on the track). */
  sendFrame(turnId: string, pcm: Int16Array): void;
  /** Button release: finalize, and start playback (consecutive playback). */
  release(turnId: string): void;
  cancel(turnId: string): void;
  close(): Promise<void>;
  /** Jitter buffer depth etc., for the soak test. */
  diagnostics(): Record<string, number>;
  /** Called from a user gesture (press): start any audio the browser blocks before one. */
  resumeAudio?(): void;
}

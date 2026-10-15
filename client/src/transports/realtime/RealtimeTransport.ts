// Realtime mode: the browser talks to OpenAI gpt-realtime directly over WebRTC.
// Docs (read 2026-10-15):
//   https://developers.openai.com/api/docs/guides/realtime-webrtc          (SDP exchange at /v1/realtime/calls)
//   https://developers.openai.com/api/docs/guides/realtime-conversations   (push-to-talk with turn_detection: null)
//   https://developers.openai.com/api/reference/resources/realtime/server-events
// The OpenAI key never reaches the browser: POST /api/realtime/session mints a short-lived client secret.

import { RemoteAudioTap } from "../../audio/remoteTap";
import { parseEvent } from "../../contracts/events";
import type { InterpreterTransport, TransportOptions, TransportSink, TurnSpec } from "../types";
import { RealtimeEventMapper, type MapperOutput } from "./eventMapper";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_RECONNECTS = 5;
const RESPONSE_START_TIMEOUT_MS = 5000;

interface SessionInfo {
  clientSecret: string;
  model: string;
  voice: string;
  transcriptionModel: string;
  directions: { source: string; target: string; instructions: string; transcriptionLanguage: string }[];
}

export class RealtimeTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RealtimeTransport implements InterpreterTransport {
  readonly mode = "realtime" as const;
  readonly kind = "WebRTC";
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private tap: RemoteAudioTap | null = null;
  private session: SessionInfo | null = null;
  private readonly mapper: RealtimeEventMapper;
  private readonly t0 = performance.now();
  private currentTurn: TurnSpec | null = null;
  private pressAt = 0;
  private closed = false;
  private reconnecting = false;
  private responseActive = false;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly sink: TransportSink,
    private readonly opts: TransportOptions,
  ) {
    this.mapper = new RealtimeEventMapper(() => performance.now() - this.t0);
  }

  async connect(): Promise<void> {
    this.sink.connection("Connecting");
    await this.open();
    this.sink.connection("Connected");
    this.sink.event(
      {
        type: "session.ready",
        t: performance.now() - this.t0,
        mode: "realtime",
        strategy: "n/a",
        providers: { stt: "gpt-realtime", translation: "gpt-realtime", translationFallback: "none", tts: "gpt-realtime" },
      },
      performance.now(),
    );
  }

  /** Mint a client secret, then WebRTC: send the gated capture track, receive the model's audio, open "oai-events". */
  private async open(): Promise<void> {
    const res = await fetch("/api/realtime/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairId: this.opts.pairId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new RealtimeTransportError(body.code ?? "provider_error", body.message ?? `Session mint failed (${res.status})`);
    }
    this.session = (await res.json()) as SessionInfo;

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.addTrack(this.opts.captureTrack, new MediaStream([this.opts.captureTrack]));

    const remote = new Promise<MediaStream>((resolve) => {
      pc.ontrack = (e) => resolve(e.streams[0] ?? new MediaStream([e.track]));
    });

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onmessage = (e) => this.onServerEvent(e.data as string);
    const dcOpen = new Promise<void>((resolve, reject) => {
      dc.onopen = () => resolve();
      dc.onerror = () => reject(new RealtimeTransportError("socket_drop", "Data channel failed to open"));
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch(OPENAI_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${this.session.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!sdpRes.ok) {
      throw new RealtimeTransportError(sdpRes.status === 429 ? "rate_limited" : "provider_error", `WebRTC SDP exchange failed (${sdpRes.status})`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

    const stream = await withTimeout(remote, 10000, "No remote audio track");
    await withTimeout(dcOpen, 10000, "Data channel did not open");

    // Playback through a media element; the AnalyserNode tap only listens (first_audible).
    this.audioEl ??= Object.assign(document.createElement("audio"), { autoplay: true });
    this.audioEl.srcObject = stream;
    await this.tap?.close();
    this.tap = new RemoteAudioTap(stream);
    // Not awaited: before a user gesture a browser keeps this pending (resumeAudio() runs on press).
    void this.tap.resume();
    void this.audioEl.play().catch(() => {});
    this.tap.onFirstAudible = (t) => this.currentTurn && this.sink.mark(this.currentTurn.turnId, "firstAudible", t);
    this.tap.onSilence = () => this.currentTurn && this.apply(this.mapper.silence(this.currentTurn.turnId));

    pc.onconnectionstatechange = () => {
      if (pc !== this.pc || this.closed) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        void this.reconnect();
      }
    };
    dc.onclose = () => {
      if (dc === this.dc && !this.closed) void this.reconnect();
    };
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;
    this.teardown();
    for (let attempt = 1; attempt <= MAX_RECONNECTS && !this.closed; attempt++) {
      this.sink.connection("Reconnecting", attempt, MAX_RECONNECTS);
      await sleep(Math.min(4000, 500 * 2 ** (attempt - 1)));
      try {
        await this.open();
        this.reconnecting = false;
        this.sink.connection("Connected");
        return;
      } catch {
        this.teardown();
      }
    }
    this.reconnecting = false;
    if (!this.closed) this.sink.connection("Failed");
  }

  private send(msg: object): void {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
  }

  startTurn(spec: TurnSpec): void {
    this.currentTurn = spec;
    this.pressAt = performance.now();
    this.mapper.beginTurn(spec);
    const dir = this.session?.directions.find((d) => d.source === spec.source && d.target === spec.target);
    if (this.responseActive) {
      // Floor control should prevent this; be safe if a response is still running.
      this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
    }
    if (dir) {
      // Retarget the session for this speaker's direction before any audio is committed.
      this.send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: dir.instructions,
          audio: { input: { transcription: { model: this.session!.transcriptionModel, language: dir.transcriptionLanguage } } },
        },
      });
    }
    this.send({ type: "input_audio_buffer.clear" });
    // The track is already live; the PTT gate opened with this press.
    this.sink.mark(spec.turnId, "access", performance.now());
    this.sink.event({ type: "turn.start", turnId: spec.turnId, t: performance.now() - this.t0, speaker: spec.speaker, direction: `${spec.source}-${spec.target}` }, performance.now());
  }

  /** From the press gesture: autoplay policies may have held back the remote audio and the tap. */
  resumeAudio(): void {
    void this.tap?.resume();
    if (this.audioEl?.paused) void this.audioEl.play().catch(() => {});
  }

  sendFrame(): void {
    /* Realtime audio travels on the WebRTC track, not as frames. */
  }

  release(turnId: string): void {
    if (this.currentTurn?.turnId !== turnId) return;
    this.mapper.setAudioSeconds(turnId, (performance.now() - this.pressAt) / 1000);
    this.tap?.arm();
    this.send({ type: "input_audio_buffer.commit" });
    const dir = this.session?.directions.find((d) => d.source === this.currentTurn!.source && d.target === this.currentTurn!.target);
    this.send({ type: "response.create", response: dir ? { instructions: dir.instructions } : {} });
    this.responseActive = true;
    this.responseTimer = setTimeout(() => this.onResponseTimeout(turnId), RESPONSE_START_TIMEOUT_MS);
  }

  /** No response.created within the timeout: fail the turn as provider_timeout and free the floor. */
  private onResponseTimeout(turnId: string): void {
    if (this.currentTurn?.turnId !== turnId) return;
    const t = performance.now() - this.t0;
    const dir = `${this.currentTurn.source}-${this.currentTurn.target}`;
    this.sink.event({ type: "error", turnId, t, code: "provider_timeout", message: `No response from gpt-realtime within ${RESPONSE_START_TIMEOUT_MS / 1000} s`, retryable: true, provider: "openai-realtime", stage: "response" }, performance.now());
    this.sink.event({ type: "turn.end", turnId, t, speaker: this.currentTurn.speaker, direction: dir, status: "failed" }, performance.now());
    this.cancel(turnId);
    this.sink.playbackEnded(turnId);
  }

  cancel(turnId: string): void {
    if (this.currentTurn?.turnId !== turnId) return;
    this.tap?.disarm();
    if (this.responseActive) {
      this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
    }
    this.send({ type: "input_audio_buffer.clear" });
    this.currentTurn = null;
  }

  private onServerEvent(data: string): void {
    let raw: { type: string; [k: string]: unknown };
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    if (raw.type === "response.created" && this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
    if (raw.type === "response.done") this.responseActive = false;
    this.apply(this.mapper.handle(raw, performance.now()));
  }

  private apply(out: MapperOutput): void {
    const now = performance.now();
    for (const m of out.marks) this.sink.mark(m.turnId, m.name, m.t);
    for (const e of out.events) this.sink.event(parseEvent(e), now);
    for (const id of out.playbackStarted) this.sink.playbackStarted(id);
    for (const id of out.playbackEnded) {
      if (this.currentTurn?.turnId === id) this.tap?.disarm();
      this.sink.playbackEnded(id);
    }
    for (const msg of out.send) this.send(msg);
  }

  /** Soak-test hook: drop the transport to measure recovery. */
  forceDrop(): void {
    this.pc?.close();
    void this.reconnect();
  }

  private teardown(): void {
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
    this.responseActive = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.teardown();
    await this.tap?.close();
    if (this.audioEl) this.audioEl.srcObject = null;
    this.sink.connection("Closed");
  }

  diagnostics(): Record<string, number> {
    return { reconnecting: this.reconnecting ? 1 : 0 };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new RealtimeTransportError("socket_drop", message)), ms))]);
}

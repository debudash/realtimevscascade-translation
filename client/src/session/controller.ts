// WorkbenchController: the mode-agnostic session layer. It owns the audio engine, the turn/floor
// machine, the metrics store and the active transport, and exposes an immutable snapshot for React.
// It consumes only normalized events and transport signals; it never touches WebRTC or WebSocket.

import { api, type AppConfig, type ClipInfo, type Health, type PairInfo } from "../api";
import { CaptureEngine, MicDeniedError, type CapturedFrame } from "../audio/captureEngine";
import { EnergyDetector } from "../audio/energyDetector";
import { Player } from "../audio/player";
import type { ErrorCode, WorkbenchEvent } from "../contracts/events";
import { MetricsStore, type RunConditions, type Strategy } from "../state/metrics";
import { initialTurnState, turnReducer, type Mode, type TurnAction, type TurnEffect, type TurnState } from "../state/turnMachine";
import type { ConnectionState, InterpreterTransport, TransportSink } from "../transports/types";

export type ChipId = "capture" | "stt" | "commit" | "translate" | "tts" | "model" | "playing";

export interface LiveTurnView {
  turnId: string;
  speaker: string;
  source: string;
  target: string;
  mode: Mode;
  strategy: Strategy | null;
  sourceStable: string;
  sourcePartial: string;
  targetText: string;
}

export interface SessionError {
  code: ErrorCode;
  message: string;
  attempt?: number;
  maxAttempts?: number;
}

export interface Toast {
  id: number;
  title: string;
  body: string;
}

export interface Snapshot {
  health: Health | null;
  config: AppConfig | null;
  clips: ClipInfo[];
  turn: TurnState;
  strategy: Strategy;
  pairId: string;
  /** "mic" or a clip id. */
  input: string;
  connection: { state: ConnectionState; kind: string; attempt?: number; maxAttempts?: number };
  /** 0..1, for the level bar. */
  level: number;
  activeChip: ChipId | null;
  live: LiveTurnView | null;
  listeningSince: number | null;
  /** Speaker whose press was just denied (shown for ~1.4 s). */
  denied: string | null;
  notReadyFlash: string | null;
  sessionError: SessionError | null;
  toast: Toast | null;
  /** Bumps whenever turn metrics change. */
  metricsVersion: number;
  providerOverride: Record<string, string> | undefined;
}

export interface TransportFactoryArgs {
  mode: Mode;
  sink: TransportSink;
  player: Player;
  capture: CaptureEngine;
  pairId: string;
  strategy: Strategy;
  providers?: Record<string, string>;
}

export type TransportFactory = (args: TransportFactoryArgs) => InterpreterTransport;

const DENY_SHOW_MS = 1400;
const REPLAY_TAIL_MS = 250;
const TURN_SAFETY_TIMEOUT_MS = 30000;

const SESSION_LEVEL_ERRORS: ErrorCode[] = ["socket_drop", "config_error", "mic_denied"];

function newTurnId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export class WorkbenchController {
  readonly metrics = new MetricsStore();
  private readonly capture = new CaptureEngine();
  private readonly player = new Player();
  private readonly detector = new EnergyDetector();
  private transport: InterpreterTransport | null = null;
  private transportGen = 0;
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private clipBuffer: AudioBuffer | null = null;
  private turnFlags = new Map<string, { ended: boolean; played: boolean; timer?: ReturnType<typeof setTimeout> }>();
  private lastLevelAt = 0;
  private toastSeq = 0;
  private replayRunning = false;

  constructor(
    private readonly makeTransport: TransportFactory,
    initialMode: Mode = "cascade",
    providerOverride?: Record<string, string>,
  ) {
    this.snap = {
      health: null,
      config: null,
      clips: [],
      turn: initialTurnState(initialMode),
      strategy: "segment",
      pairId: "en-es",
      input: "mic",
      connection: { state: "Connecting", kind: "" },
      level: 0,
      activeChip: null,
      live: null,
      listeningSince: null,
      denied: null,
      notReadyFlash: null,
      sessionError: null,
      toast: null,
      metricsVersion: 0,
      providerOverride,
    };
    this.capture.onFrame = (f) => this.onFrame(f);
    this.metrics.subscribe(() => this.set({ metricsVersion: this.metrics.getVersion() }));
  }

  // ---- store plumbing (useSyncExternalStore) ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ---- lifecycle ----
  private started: Promise<void> | null = null;

  /** Idempotent: loads config, initializes audio, and warms the initial mode. */
  start(): Promise<void> {
    this.started ??= this.doStart();
    return this.started;
  }

  private async doStart(): Promise<void> {
    const [health, config, clips] = await Promise.all([api.health(), api.config(), api.clips().catch(() => [])]);
    this.set({ health, config, clips, pairId: config.defaultPair });
    await Promise.all([this.capture.init(), this.player.init()]);
    if (!health.configOk && !this.usesOnlyFakes()) {
      this.set({ sessionError: { code: "config_error", message: health.missing.join(", ") } });
      this.dispatch({ type: "ERROR", code: "config_error" });
      return;
    }
    await this.selectInput(this.snap.input);
    await this.warm(this.snap.turn.mode);
  }

  private usesOnlyFakes(): boolean {
    const o = this.snap.providerOverride;
    return !!o && Object.values(o).every((v) => v === "fake");
  }

  get pair(): PairInfo | undefined {
    return this.snap.config?.pairs.find((p) => p.id === this.snap.pairId);
  }

  /** Warm-up: open the transport (WebRTC or WebSocket) and provider connections before Ready. */
  private async warm(mode: Mode): Promise<void> {
    const gen = ++this.transportGen;
    const old = this.transport;
    this.transport = null;
    await old?.close();
    this.set({ connection: { state: "Connecting", kind: "" } });
    const transport = this.makeTransport({
      mode,
      sink: this.sinkFor(gen),
      player: this.player,
      capture: this.capture,
      pairId: this.snap.pairId,
      strategy: this.snap.strategy,
      providers: this.snap.providerOverride,
    });
    this.transport = transport;
    this.set({ connection: { state: "Connecting", kind: transport.kind } });
    try {
      await transport.connect();
      if (gen !== this.transportGen) return;
      this.dispatch({ type: "WARM_DONE" });
    } catch (e) {
      if (gen !== this.transportGen) return;
      this.failSession("internal", (e as Error).message);
    }
  }

  // ---- user intents ----
  async press(speaker: string): Promise<void> {
    await Promise.all([this.capture.resume(), this.player.resume()]);
    if (this.snap.input !== "mic") {
      await this.runReplayTurn(speaker);
      return;
    }
    this.dispatch({ type: "PRESS", speaker, turnId: newTurnId() });
  }

  release(speaker: string): void {
    if (this.snap.input !== "mic") return; // replay turns release themselves
    this.dispatch({ type: "RELEASE", speaker });
  }

  /** Replay: plays the selected clip through the capture path with press/release automated around it. */
  async runReplayTurn(speaker: string): Promise<void> {
    if (!this.clipBuffer) return;
    if (this.replayRunning) {
      this.dispatch({ type: "PRESS", speaker, turnId: newTurnId() }); // will be denied / not ready
      return;
    }
    const turnId = newTurnId();
    this.dispatch({ type: "PRESS", speaker, turnId });
    if (this.snap.turn.turnId !== turnId) return;
    this.replayRunning = true;
    try {
      await this.capture.playClip(this.clipBuffer);
      await new Promise((r) => setTimeout(r, REPLAY_TAIL_MS));
      this.dispatch({ type: "RELEASE", speaker });
    } finally {
      this.replayRunning = false;
    }
  }

  switchMode(mode: Mode): void {
    this.dispatch({ type: "SWITCH_MODE", mode });
  }

  stayOnCurrent(): void {
    this.dispatch({ type: "CANCEL_SWITCH" });
  }

  setStrategy(strategy: Strategy): void {
    if (strategy === this.snap.strategy) return;
    this.set({ strategy });
    // The commit policy is chosen per cascade session; re-warm when idle.
    if (this.snap.turn.mode === "cascade") void this.rewarm();
  }

  async setPair(pairId: string): Promise<void> {
    if (pairId === this.snap.pairId || this.snap.turn.phase !== "Ready") return;
    this.set({ pairId });
    await this.rewarm();
  }

  /** Re-open the current mode's transport with new session settings (only between turns). */
  private async rewarm(): Promise<void> {
    if (this.snap.turn.phase !== "Ready") return;
    this.set({ turn: { ...this.snap.turn, phase: "Warming" } });
    await this.warm(this.snap.turn.mode);
  }

  async selectInput(input: string): Promise<void> {
    this.set({ input });
    if (input === "mic") {
      this.clipBuffer = null;
      try {
        await this.capture.useMic();
        if (this.snap.sessionError?.code === "mic_denied") this.recover();
      } catch (e) {
        if (e instanceof MicDeniedError) {
          this.set({ sessionError: { code: "mic_denied", message: e.message } });
          this.dispatch({ type: "ERROR", code: "mic_denied" });
          return;
        }
        throw e;
      }
    } else {
      this.capture.releaseMic();
      this.clipBuffer = await this.capture.loadClip(`/api/clips/${encodeURIComponent(input)}.wav`);
      if (this.snap.sessionError?.code === "mic_denied") this.recover();
    }
  }

  private recover(): void {
    this.set({ sessionError: null });
    this.dispatch({ type: "RECOVER" });
    if (this.snap.turn.phase === "Ready" && !this.transport) void this.warm(this.snap.turn.mode);
  }

  dismissToast(): void {
    this.set({ toast: null });
  }

  exportMetrics(): string {
    return this.metrics.export();
  }

  diagnostics(): Record<string, number> {
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    return { ...(this.transport?.diagnostics() ?? {}), ...(heap ? { heapBytes: heap } : {}) };
  }

  /** Test/soak hook: simulate a transport drop. */
  async forceDrop(): Promise<void> {
    const t = this.transport as unknown as { forceDrop?: () => void };
    t?.forceDrop?.();
  }

  // ---- state machine ----
  private dispatch(action: TurnAction): void {
    const { state, effects } = turnReducer(this.snap.turn, action);
    this.set({ turn: state, ...(state.phase === "Ready" ? { activeChip: null, listeningSince: null } : {}) });
    effects.forEach((e) => this.perform(e));
  }

  private perform(effect: TurnEffect): void {
    switch (effect.type) {
      case "startTurn":
        return this.startTurn(effect.speaker, effect.turnId);
      case "releaseTurn":
        return this.releaseTurn(effect.turnId);
      case "cancelTurn":
        this.capture.setGate(false);
        this.capture.stopClip();
        this.transport?.cancel(effect.turnId);
        this.metrics.update(effect.turnId, { status: "cancelled" });
        this.clearTurnFlags(effect.turnId);
        return;
      case "floorDenied":
        this.player.denyTone();
        console.info("floor.denied", effect.speaker); // log only, not a tracked metric
        this.flash("denied", effect.speaker);
        return;
      case "notReady":
        this.flash("notReadyFlash", effect.speaker);
        return;
      case "applyMode":
        void this.warm(effect.mode);
        return;
      case "switchQueued":
        return;
    }
  }

  private flash(key: "denied" | "notReadyFlash", speaker: string): void {
    this.set({ [key]: speaker } as Partial<Snapshot>);
    setTimeout(() => {
      if (this.snap[key] === speaker) this.set({ [key]: null } as Partial<Snapshot>);
    }, DENY_SHOW_MS);
  }

  private conditions(speaker: string, target: string): RunConditions {
    const t = this.transport;
    const providers =
      this.snap.turn.mode === "realtime"
        ? ["gpt-realtime"]
        : [this.lastProviders?.stt, this.lastProviders?.translation, this.lastProviders?.tts].filter((p): p is string => !!p);
    return {
      mode: this.snap.turn.mode,
      strategy: this.snap.turn.mode === "cascade" ? this.snap.strategy : null,
      providers: providers.length ? providers : [t?.kind ?? "unknown"],
      pair: this.snap.pairId,
      direction: `${speaker}-${target}`,
      inputSource: this.snap.input,
    };
  }

  private lastProviders: Record<string, string> | null = null;

  private startTurn(speaker: string, turnId: string): void {
    const pair = this.pair;
    const target = pair ? (speaker === pair.a ? pair.b : pair.a) : speaker === "en" ? "es" : "en";
    const now = performance.now();
    this.metrics.startTurn(turnId, speaker, this.conditions(speaker, target), now);
    this.turnFlags.set(turnId, { ended: false, played: false });
    this.detector.reset();
    this.capture.setGate(true);
    this.transport?.startTurn({ turnId, speaker, source: speaker, target });
    this.set({
      listeningSince: now,
      activeChip: "capture",
      live: {
        turnId,
        speaker,
        source: speaker,
        target,
        mode: this.snap.turn.mode,
        strategy: this.snap.turn.mode === "cascade" ? this.snap.strategy : null,
        sourceStable: "",
        sourcePartial: "",
        targetText: "",
      },
    });
  }

  private releaseTurn(turnId: string): void {
    const now = performance.now();
    this.capture.setGate(false);
    const t0 = this.detector.lastVoicedEnd;
    if (t0 !== null) this.metrics.setMark(turnId, "t0", Math.min(t0, now));
    this.metrics.mark(turnId, "release", now);
    this.transport?.release(turnId);
    this.set({ listeningSince: null, activeChip: this.snap.turn.mode === "realtime" ? "model" : this.snap.activeChip });
    const flags = this.turnFlags.get(turnId);
    if (flags) {
      flags.timer = setTimeout(() => {
        // Safety net: never leave the floor locked if a transport fails to report.
        if (this.snap.turn.turnId === turnId) {
          this.metrics.update(turnId, { status: "failed", error: { code: "internal", message: "Turn did not finish in 30 s" } });
          this.dispatch({ type: "TURN_DONE" });
        }
      }, TURN_SAFETY_TIMEOUT_MS);
    }
  }

  private onFrame(f: CapturedFrame): void {
    const { phase, turnId } = this.snap.turn;
    const capturing = phase === "Capturing" && turnId;
    if (capturing) {
      for (const ev of this.detector.push(f.pcm, f.startMs, f.endMs - f.startMs)) {
        if (ev.type === "speech_start") this.metrics.mark(turnId, "speechStart", ev.t);
      }
      this.transport?.sendFrame(turnId, f.pcm);
    }
    const now = performance.now();
    if (now - this.lastLevelAt > 50) {
      this.lastLevelAt = now;
      const level = capturing ? Math.max(0, Math.min(1, (this.detector.level + 60) / 60)) : 0;
      if (level !== this.snap.level) this.set({ level });
    }
  }

  // ---- transport signals ----
  private sinkFor(gen: number): TransportSink {
    const live = () => gen === this.transportGen;
    return {
      event: (e, receivedAt) => live() && this.onEvent(e, receivedAt),
      connection: (state, attempt, maxAttempts) => live() && this.onConnection(state, attempt, maxAttempts),
      mark: (turnId, name, t) => live() && this.metrics.mark(turnId, name, t),
      playbackStarted: (turnId) => {
        if (!live() || this.snap.turn.turnId !== turnId) return;
        this.set({ activeChip: "playing" });
        this.dispatch({ type: "PLAYBACK_START" });
      },
      playbackEnded: (turnId) => {
        if (!live()) return;
        const f = this.turnFlags.get(turnId);
        if (f) {
          f.played = true;
          this.maybeFinish(turnId);
        }
      },
    };
  }

  private onConnection(state: ConnectionState, attempt?: number, maxAttempts?: number): void {
    const prev = this.snap.connection.state;
    this.set({ connection: { state, kind: this.transport?.kind ?? "", attempt, maxAttempts } });
    if (state === "Reconnecting") {
      this.set({ sessionError: { code: "socket_drop", message: "Connection lost", attempt, maxAttempts } });
      if (this.snap.turn.phase !== "Error") this.dispatch({ type: "ERROR", code: "socket_drop" });
    } else if (state === "Connected" && prev === "Reconnecting") {
      if (this.snap.sessionError?.code === "socket_drop") this.set({ sessionError: null });
      this.dispatch({ type: "RECOVER" });
    } else if (state === "Failed") {
      this.set({ sessionError: { code: "socket_drop", message: "Connection failed after 5 attempts. Reload to retry." } });
      if (this.snap.turn.phase !== "Error") this.dispatch({ type: "ERROR", code: "socket_drop" });
    }
  }

  private onEvent(e: WorkbenchEvent, receivedAt: number): void {
    const live = this.snap.live && e.turnId === this.snap.live.turnId ? this.snap.live : null;
    switch (e.type) {
      case "session.ready":
        this.lastProviders = { ...e.providers };
        return;
      case "source.partial":
        this.metrics.update(e.turnId!, { sourceText: e.text });
        if (live) this.set({ live: { ...live, sourceStable: e.stable, sourcePartial: e.text.slice(e.stable.length) }, activeChip: "stt" });
        return;
      case "source.final":
        this.metrics.update(e.turnId!, { sourceText: e.text });
        if (live) this.set({ live: { ...live, sourceStable: e.text, sourcePartial: "" }, activeChip: "stt" });
        return;
      case "segment.commit":
        this.set({ activeChip: "commit" });
        return;
      case "target.partial":
      case "target.final":
        this.metrics.update(e.turnId!, { targetText: e.text });
        if (live) this.set({ live: { ...live, targetText: e.text }, activeChip: "translate" });
        return;
      case "audio.chunk":
        if (this.snap.activeChip !== "playing") this.set({ activeChip: "tts" });
        return;
      case "stage.timing":
        this.metrics.stage(e.turnId!, { stage: e.stage, durationMs: e.durationMs, segment: e.segment, provider: e.provider, receivedAt });
        return;
      case "provider.failover":
        if (e.turnId) this.metrics.update(e.turnId, { failoverNote: `${e.stage}: ${e.from} → ${e.to} (${e.reason})` });
        this.set({
          toast: {
            id: ++this.toastSeq,
            title: "Translation provider busy",
            body: `Got 429 three times. Switched to ${e.to === "deepl" ? "DeepL" : e.to} for 60 s. This is recorded on the turn.`,
          },
        });
        return;
      case "turn.end": {
        this.metrics.update(e.turnId!, {
          status: e.status === "completed" ? "completed" : e.status,
          usage: e.usage,
          providersUsed: e.providersUsed,
          ...(e.failoverNote ? { failoverNote: e.failoverNote } : {}),
        });
        const f = this.turnFlags.get(e.turnId!);
        if (f) {
          f.ended = true;
          this.maybeFinish(e.turnId!);
        }
        return;
      }
      case "error":
        if (SESSION_LEVEL_ERRORS.includes(e.code)) {
          this.failSession(e.code, e.message);
        } else if (e.turnId) {
          this.metrics.update(e.turnId, {
            status: e.code === "empty_result" ? "empty" : "failed",
            error: { code: e.code, message: e.message, stage: e.stage, httpStatus: e.httpStatus },
          });
        } else {
          this.set({ toast: { id: ++this.toastSeq, title: "Error", body: `${e.code}: ${e.message}` } });
        }
        return;
      case "turn.start":
      case "floor.denied":
        return;
    }
  }

  private maybeFinish(turnId: string): void {
    const f = this.turnFlags.get(turnId);
    if (!f || !f.ended || !f.played) return;
    this.clearTurnFlags(turnId);
    const rec = this.metrics.get(turnId);
    if (rec?.status === "live") this.metrics.update(turnId, { status: "completed" });
    if (this.snap.turn.turnId === turnId) {
      this.dispatch({ type: "TURN_DONE" });
      this.set({ live: null });
    }
  }

  private clearTurnFlags(turnId: string): void {
    const f = this.turnFlags.get(turnId);
    if (f?.timer) clearTimeout(f.timer);
    this.turnFlags.delete(turnId);
  }

  private failSession(code: ErrorCode, message: string): void {
    this.set({ sessionError: { code, message } });
    this.dispatch({ type: "ERROR", code });
  }
}

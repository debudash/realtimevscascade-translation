// Per-turn timing marks and run conditions (docs/architecture.md §7).
// All marks are browser-clock milliseconds (performance.now()).

import type { Stage, TurnUsage } from "../contracts/events";
import type { Mode } from "./turnMachine";

export type MarkName =
  | "press"
  | "access"
  | "speechStart"
  | "t0"
  | "release"
  | "sttFinal"
  | "translateFirstToken"
  | "translateDone"
  | "ttsFirstByte"
  | "rtResponseStart"
  | "firstAudible";

export const STAGE_MARK: Record<Stage, MarkName> = {
  stt_final: "sttFinal",
  translate_first_token: "translateFirstToken",
  translate_done: "translateDone",
  tts_first_byte: "ttsFirstByte",
};

export type Strategy = "segment" | "clause";

export interface RunConditions {
  mode: Mode;
  /** Commit strategy; null in Realtime mode. */
  strategy: Strategy | null;
  providers: string[];
  pair: string;
  direction: string;
  /** "mic" or the replay clip id. */
  inputSource: string;
}

export interface StageDuration {
  stage: Stage;
  durationMs: number;
  segment: number;
  provider: string;
  /** Browser time the stage.timing event arrived. */
  receivedAt: number;
}

export type TurnStatus = "live" | "completed" | "empty" | "cancelled" | "failed";

export interface TurnRecord {
  turnId: string;
  speaker: string;
  conditions: RunConditions;
  startedAtIso: string;
  marks: Partial<Record<MarkName, number>>;
  stages: StageDuration[];
  sourceText: string;
  targetText: string;
  status: TurnStatus;
  usage?: TurnUsage;
  providersUsed?: string[];
  failoverNote?: string;
  error?: { code: string; message: string; stage?: string; httpStatus?: number };
}

/** Headline: mouth-to-ear = first_audible - T0. */
export function mouthToEarMs(t: TurnRecord): number | null {
  const { t0, firstAudible } = t.marks;
  return t0 !== undefined && firstAudible !== undefined ? firstAudible - t0 : null;
}

/** Access time = access - press. */
export function accessMs(t: TurnRecord): number | null {
  const { press, access } = t.marks;
  return press !== undefined && access !== undefined ? access - press : null;
}

/** Linear-interpolated percentile (p in 0..100). Returns null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export type ConfigKey = "realtime" | "cascade-segment" | "cascade-clause";

export function configKey(c: RunConditions): ConfigKey {
  return c.mode === "realtime" ? "realtime" : c.strategy === "clause" ? "cascade-clause" : "cascade-segment";
}

/** Targets from the brief: Realtime < 1.5 s; Cascade < 3 s (segment), stretch < 2 s (clause row). */
export const TARGET_MS: Record<ConfigKey, number> = {
  realtime: 1500,
  "cascade-segment": 3000,
  "cascade-clause": 2000,
};

export interface Summary {
  key: ConfigKey;
  n: number;
  p50: number | null;
  p95: number | null;
  targetMs: number;
  /** null when there are no samples yet. */
  meetsTarget: boolean | null;
}

export function summarize(turns: TurnRecord[]): Summary[] {
  return (Object.keys(TARGET_MS) as ConfigKey[]).map((key) => {
    const values = turns
      .filter((t) => t.status === "completed" && configKey(t.conditions) === key)
      .map(mouthToEarMs)
      .filter((v): v is number => v !== null);
    const p95 = percentile(values, 95);
    return {
      key,
      n: values.length,
      p50: percentile(values, 50),
      p95,
      targetMs: TARGET_MS[key],
      meetsTarget: p95 === null ? null : p95 < TARGET_MS[key],
    };
  });
}

type Listener = () => void;

/** Holds every turn of the session. Marks are first-write-wins except stage marks (latest segment wins). */
export class MetricsStore {
  private turns = new Map<string, TurnRecord>();
  private order: string[] = [];
  private listeners = new Set<Listener>();
  private version = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion(): number {
    return this.version;
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  startTurn(turnId: string, speaker: string, conditions: RunConditions, press: number): TurnRecord {
    const rec: TurnRecord = {
      turnId,
      speaker,
      conditions,
      startedAtIso: new Date().toISOString(),
      marks: { press },
      stages: [],
      sourceText: "",
      targetText: "",
      status: "live",
    };
    this.turns.set(turnId, rec);
    this.order.push(turnId);
    this.changed();
    return rec;
  }

  get(turnId: string): TurnRecord | undefined {
    return this.turns.get(turnId);
  }

  /** Newest first. */
  all(): TurnRecord[] {
    return this.order.map((id) => this.turns.get(id)!).reverse();
  }

  last(): TurnRecord | undefined {
    const id = this.order[this.order.length - 1];
    return id ? this.turns.get(id) : undefined;
  }

  mark(turnId: string, name: MarkName, t: number): void {
    const rec = this.turns.get(turnId);
    if (!rec || rec.marks[name] !== undefined) return;
    rec.marks[name] = t;
    this.changed();
  }

  /** Overwrites; used for T0, which is only known for sure at release. */
  setMark(turnId: string, name: MarkName, t: number): void {
    const rec = this.turns.get(turnId);
    if (!rec) return;
    rec.marks[name] = t;
    this.changed();
  }

  stage(turnId: string, d: StageDuration): void {
    const rec = this.turns.get(turnId);
    if (!rec) return;
    rec.stages.push(d);
    // The waterfall shows the final segment, so the latest segment's receipt time wins.
    const name = STAGE_MARK[d.stage];
    const prevSeg = Math.max(-1, ...rec.stages.filter((s) => s.stage === d.stage && s !== d).map((s) => s.segment));
    if (d.segment >= prevSeg) rec.marks[name] = d.receivedAt;
    this.changed();
  }

  update(turnId: string, patch: Partial<Omit<TurnRecord, "turnId" | "marks" | "stages">>): void {
    const rec = this.turns.get(turnId);
    if (!rec) return;
    Object.assign(rec, patch);
    this.changed();
  }

  completedCount(): number {
    return this.order.filter((id) => this.turns.get(id)!.status === "completed").length;
  }

  /** JSON export: all turns, marks, durations and run conditions. */
  export(): string {
    const turns = this.order.map((id) => {
      const t = this.turns.get(id)!;
      return { ...t, mouthToEarMs: mouthToEarMs(t), accessMs: accessMs(t) };
    });
    return JSON.stringify({ exportedAt: new Date().toISOString(), summary: summarize(this.all()), turns }, null, 2);
  }
}

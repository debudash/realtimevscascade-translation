// Normalized event schema shared by both transports (docs/architecture.md §3).
// Hand-maintained mirror of server/src/Workbench.Core/Events/WorkbenchEvents.cs.
// contracts/event-samples.json is round-tripped by both sides' contract tests.

export type ErrorCode =
  | "mic_denied"
  | "socket_drop"
  | "provider_timeout"
  | "rate_limited"
  | "empty_result"
  | "config_error"
  | "provider_error"
  | "internal";

export type Stage = "stt_final" | "translate_first_token" | "translate_done" | "tts_first_byte";

export interface ProviderSet {
  stt: string;
  translation: string;
  translationFallback: string;
  tts: string;
}

export interface TurnUsage {
  sttAudioSeconds: number;
  translationInputTokens: number;
  translationOutputTokens: number;
  translationCharacters: number;
  ttsCharacters: number;
}

interface Base {
  turnId?: string;
  t: number;
}

export interface SessionReadyEvent extends Base { type: "session.ready"; mode: string; providers: ProviderSet; strategy: string }
export interface TurnStartEvent extends Base { type: "turn.start"; speaker: string; direction: string }
export interface TurnEndEvent extends Base {
  type: "turn.end";
  speaker: string;
  direction: string;
  status: "completed" | "empty" | "cancelled" | "failed";
  usage?: TurnUsage;
  providersUsed?: string[];
  failoverNote?: string;
}
export interface SourcePartialEvent extends Base { type: "source.partial"; text: string; lang: string; stable: string }
export interface SourceFinalEvent extends Base { type: "source.final"; text: string; lang: string }
export interface SegmentCommitEvent extends Base { type: "segment.commit"; segment: number; text: string }
export interface TargetPartialEvent extends Base { type: "target.partial"; text: string; lang: string }
export interface TargetFinalEvent extends Base { type: "target.final"; text: string; lang: string }
/** data: base64 PCM16 little-endian mono. */
export interface AudioChunkEvent extends Base { type: "audio.chunk"; data: string; sampleRate: number; segment: number }
export interface StageTimingEvent extends Base { type: "stage.timing"; stage: Stage; durationMs: number; segment: number; provider: string }
export interface ProviderFailoverEvent extends Base { type: "provider.failover"; stage: string; from: string; to: string; reason: string }
export interface FloorDeniedEvent extends Base { type: "floor.denied"; speaker: string }
export interface ErrorEvent extends Base {
  type: "error";
  code: ErrorCode;
  message: string;
  retryable: boolean;
  provider?: string;
  stage?: string;
  httpStatus?: number;
}

export type WorkbenchEvent =
  | SessionReadyEvent
  | TurnStartEvent
  | TurnEndEvent
  | SourcePartialEvent
  | SourceFinalEvent
  | SegmentCommitEvent
  | TargetPartialEvent
  | TargetFinalEvent
  | AudioChunkEvent
  | StageTimingEvent
  | ProviderFailoverEvent
  | FloorDeniedEvent
  | ErrorEvent;

export type EventType = WorkbenchEvent["type"];

type FieldKind = "string" | "number" | "boolean" | "object" | "array";

/** Required fields per event type (beyond `type` and `t`). Used by parseEvent and the contract test. */
export const REQUIRED_FIELDS: Record<EventType, Record<string, FieldKind>> = {
  "session.ready": { mode: "string", providers: "object", strategy: "string" },
  "turn.start": { speaker: "string", direction: "string" },
  "turn.end": { speaker: "string", direction: "string", status: "string" },
  "source.partial": { text: "string", lang: "string", stable: "string" },
  "source.final": { text: "string", lang: "string" },
  "segment.commit": { segment: "number", text: "string" },
  "target.partial": { text: "string", lang: "string" },
  "target.final": { text: "string", lang: "string" },
  "audio.chunk": { data: "string", sampleRate: "number", segment: "number" },
  "stage.timing": { stage: "string", durationMs: "number", segment: "number", provider: "string" },
  "provider.failover": { stage: "string", from: "string", to: "string", reason: "string" },
  "floor.denied": { speaker: "string" },
  error: { code: "string", message: "string", retryable: "boolean" },
};

export const EVENT_TYPES = Object.keys(REQUIRED_FIELDS) as EventType[];

function kindOf(v: unknown): FieldKind | "other" {
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" || t === "object" ? (t as FieldKind) : "other";
}

/** Parses and validates one server event. Throws on unknown types or missing fields. */
export function parseEvent(json: string | unknown): WorkbenchEvent {
  const raw = typeof json === "string" ? JSON.parse(json) : json;
  if (!raw || typeof raw !== "object") throw new Error("Event is not an object");
  const obj = raw as Record<string, unknown>;
  const type = obj.type as EventType;
  const fields = REQUIRED_FIELDS[type];
  if (!fields) throw new Error(`Unknown event type: ${String(obj.type)}`);
  if (typeof obj.t !== "number") throw new Error(`${type}: missing t`);
  for (const [name, kind] of Object.entries(fields)) {
    if (kindOf(obj[name]) !== kind) throw new Error(`${type}: field ${name} should be ${kind}`);
  }
  return obj as unknown as WorkbenchEvent;
}

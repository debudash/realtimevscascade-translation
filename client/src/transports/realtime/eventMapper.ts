// Maps OpenAI Realtime (GA) data-channel events to the normalized schema.
// Event names verified 2026-10-15: https://developers.openai.com/api/reference/resources/realtime/server-events
// Pure: no I/O, no clocks (the caller passes `now`). Unit-tested in eventMapper.test.ts.

import type { ErrorCode, EventInput, TurnUsage, WorkbenchEvent } from "../../contracts/events";
import type { MarkName } from "../../state/metrics";

export interface MapperTurn {
  turnId: string;
  speaker: string;
  source: string;
  target: string;
}

export interface MapperOutput {
  events: WorkbenchEvent[];
  marks: { turnId: string; name: MarkName; t: number }[];
  playbackStarted: string[];
  playbackEnded: string[];
  /** Client events to send back on the data channel (e.g. pruning old conversation items). */
  send: object[];
}

type ServerEvent = { type: string; [k: string]: unknown };

/** How many past turns of conversation context the model keeps (matches the cascade's last-2-segments context). */
export const CONTEXT_TURNS = 2;

interface TurnState extends MapperTurn {
  sourceText: Map<string, string>; // item_id -> transcript (delta-accumulated)
  targetText: string;
  responseId: string | null;
  audioStarted: boolean;
  playbackEnded: boolean;
  responseDone: boolean;
  items: string[];
  audioSeconds: number;
}

function newOutput(): MapperOutput {
  return { events: [], marks: [], playbackStarted: [], playbackEnded: [], send: [] };
}

export class RealtimeEventMapper {
  private turns = new Map<string, TurnState>();
  private current: TurnState | null = null;
  private itemToTurn = new Map<string, string>();
  private responseToTurn = new Map<string, string>();
  private finishedTurns: string[] = [];

  constructor(private readonly clock: () => number) {}

  beginTurn(turn: MapperTurn): void {
    const state: TurnState = {
      ...turn,
      sourceText: new Map(),
      targetText: "",
      responseId: null,
      audioStarted: false,
      playbackEnded: false,
      responseDone: false,
      items: [],
      audioSeconds: 0,
    };
    this.turns.set(turn.turnId, state);
    this.current = state;
  }

  /** Captured audio duration for the turn (priced as transcription input). */
  setAudioSeconds(turnId: string, seconds: number): void {
    const t = this.turns.get(turnId);
    if (t) t.audioSeconds = seconds;
  }

  private ev(e: EventInput): WorkbenchEvent {
    return { ...e, t: this.clock() } as WorkbenchEvent;
  }

  private turnFor(e: ServerEvent): TurnState | null {
    const item = (e.item_id as string | undefined) ?? (e.item as { id?: string } | undefined)?.id;
    if (item && this.itemToTurn.has(item)) return this.turns.get(this.itemToTurn.get(item)!) ?? null;
    const resp = (e.response_id as string | undefined) ?? (e.response as { id?: string } | undefined)?.id;
    if (resp && this.responseToTurn.has(resp)) return this.turns.get(this.responseToTurn.get(resp)!) ?? null;
    return this.current;
  }

  handle(raw: ServerEvent, now: number): MapperOutput {
    const out = newOutput();
    const type = raw.type;

    switch (type) {
      case "input_audio_buffer.committed": {
        const item = raw.item_id as string;
        if (this.current && item) {
          this.itemToTurn.set(item, this.current.turnId);
          this.current.items.push(item);
        }
        break;
      }

      case "conversation.item.input_audio_transcription.delta": {
        const t = this.turnFor(raw);
        if (!t) break;
        const item = raw.item_id as string;
        const text = (t.sourceText.get(item) ?? "") + String(raw.delta ?? "");
        t.sourceText.set(item, text);
        const full = [...t.sourceText.values()].join(" ").trim();
        out.events.push(this.ev({ type: "source.partial", turnId: t.turnId, text: full, lang: t.source, stable: full }));
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const t = this.turnFor(raw);
        if (!t) break;
        t.sourceText.set(raw.item_id as string, String(raw.transcript ?? "").trim());
        const full = [...t.sourceText.values()].join(" ").trim();
        out.events.push(this.ev({ type: "source.final", turnId: t.turnId, text: full, lang: t.source }));
        break;
      }

      case "response.created": {
        const t = this.current;
        const id = (raw.response as { id?: string } | undefined)?.id;
        if (!t || !id) break;
        t.responseId = id;
        this.responseToTurn.set(id, t.turnId);
        out.marks.push({ turnId: t.turnId, name: "rtResponseStart", t: now });
        break;
      }

      case "conversation.item.added":
      case "conversation.item.created": {
        // Track the assistant's output items so old context can be pruned.
        const item = (raw.item as { id?: string; role?: string } | undefined) ?? {};
        if (item.id && item.role === "assistant" && this.current) {
          this.itemToTurn.set(item.id, this.current.turnId);
          if (!this.current.items.includes(item.id)) this.current.items.push(item.id);
        }
        break;
      }

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const t = this.turnFor(raw);
        if (!t) break;
        t.targetText += String(raw.delta ?? "");
        out.events.push(this.ev({ type: "target.partial", turnId: t.turnId, text: t.targetText, lang: t.target }));
        break;
      }

      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const t = this.turnFor(raw);
        if (!t) break;
        t.targetText = String(raw.transcript ?? t.targetText).trim();
        out.events.push(this.ev({ type: "target.final", turnId: t.turnId, text: t.targetText, lang: t.target }));
        break;
      }

      case "output_audio_buffer.started": {
        const t = this.turnFor(raw);
        if (!t || t.audioStarted) break;
        t.audioStarted = true;
        out.playbackStarted.push(t.turnId);
        break;
      }

      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        const t = this.turnFor(raw);
        if (t) this.endPlayback(t, out);
        break;
      }

      case "response.done": {
        const t = this.turnFor(raw);
        if (!t) break;
        const response = (raw.response ?? {}) as {
          status?: string;
          status_details?: { error?: { code?: string; message?: string } };
          usage?: RealtimeUsageRaw;
        };
        t.responseDone = true;
        if (response.status === "failed") {
          const err = response.status_details?.error;
          out.events.push(this.errorEvent(t.turnId, err?.code, err?.message ?? "Realtime response failed"));
        }
        const status = response.status === "completed" ? "completed" : response.status === "cancelled" ? "cancelled" : "failed";
        out.events.push(
          this.ev({
            type: "turn.end",
            turnId: t.turnId,
            speaker: t.speaker,
            direction: `${t.source}-${t.target}`,
            status: status === "completed" && !t.targetText ? "empty" : status,
            usage: toUsage(response.usage, t.audioSeconds),
            providersUsed: ["gpt-realtime"],
          }),
        );
        // No audio for this response: there will be no output_audio_buffer events.
        if (!t.audioStarted) this.endPlayback(t, out);
        this.prune(t, out);
        break;
      }

      case "error": {
        const err = (raw.error ?? {}) as { code?: string; message?: string };
        const t = this.current;
        if (err.code === "input_audio_buffer_commit_empty" && t) {
          // Released with (almost) no audio: neutral empty result, end the turn.
          out.events.push(this.errorEvent(t.turnId, err.code, "No speech detected. Hold the button while you talk."));
          out.events.push(this.ev({ type: "turn.end", turnId: t.turnId, speaker: t.speaker, direction: `${t.source}-${t.target}`, status: "empty" }));
          this.endPlayback(t, out);
        } else {
          out.events.push(this.errorEvent(t && !t.responseDone ? t.turnId : undefined, err.code, err.message ?? "Realtime error"));
        }
        break;
      }
    }
    return out;
  }

  /** Fallback end-of-playback (remote track went silent) in case output_audio_buffer.stopped is missed. */
  silence(turnId: string): MapperOutput {
    const out = newOutput();
    const t = this.turns.get(turnId);
    if (t && t.responseDone) this.endPlayback(t, out);
    return out;
  }

  private endPlayback(t: TurnState, out: MapperOutput): void {
    if (t.playbackEnded) return;
    t.playbackEnded = true;
    out.playbackEnded.push(t.turnId);
  }

  private errorEvent(turnId: string | undefined, code: string | undefined, message: string): WorkbenchEvent {
    return this.ev({
      type: "error",
      ...(turnId ? { turnId } : {}),
      code: mapErrorCode(code),
      message,
      retryable: code !== "input_audio_buffer_commit_empty",
      provider: "openai-realtime",
    });
  }

  /** Keep only the last CONTEXT_TURNS turns of conversation items (bounded cost and context). */
  private prune(t: TurnState, out: MapperOutput): void {
    if (this.finishedTurns.includes(t.turnId)) return;
    this.finishedTurns.push(t.turnId);
    while (this.finishedTurns.length > CONTEXT_TURNS) {
      const old = this.turns.get(this.finishedTurns.shift()!);
      if (!old) continue;
      for (const item of old.items) out.send.push({ type: "conversation.item.delete", item_id: item });
      this.turns.delete(old.turnId);
    }
  }
}

export function mapErrorCode(code: string | undefined): ErrorCode {
  if (!code) return "provider_error";
  if (code === "rate_limit_exceeded") return "rate_limited";
  if (code === "input_audio_buffer_commit_empty") return "empty_result";
  return "provider_error";
}

interface RealtimeUsageRaw {
  input_token_details?: { audio_tokens?: number; text_tokens?: number; cached_tokens?: number };
  output_token_details?: { audio_tokens?: number; text_tokens?: number };
}

function toUsage(u: RealtimeUsageRaw | undefined, audioSeconds: number): TurnUsage | undefined {
  if (!u) return undefined;
  return {
    sttAudioSeconds: Math.round(audioSeconds * 1000) / 1000,
    translationInputTokens: 0,
    translationOutputTokens: 0,
    translationCharacters: 0,
    ttsCharacters: 0,
    realtime: {
      inputAudioTokens: u.input_token_details?.audio_tokens ?? 0,
      inputTextTokens: u.input_token_details?.text_tokens ?? 0,
      cachedInputTokens: u.input_token_details?.cached_tokens ?? 0,
      outputAudioTokens: u.output_token_details?.audio_tokens ?? 0,
      outputTextTokens: u.output_token_details?.text_tokens ?? 0,
    },
  };
}

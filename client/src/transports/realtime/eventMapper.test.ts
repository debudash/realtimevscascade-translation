import { describe, expect, it } from "vitest";
import { CONTEXT_TURNS, RealtimeEventMapper, mapErrorCode } from "./eventMapper";

function mapper() {
  let t = 0;
  const m = new RealtimeEventMapper(() => ++t);
  return m;
}

const turn = (id: string) => ({ turnId: id, speaker: "en", source: "en", target: "es" });

/** A typical push-to-talk turn's server events, in arrival order. */
function turnEvents(n: number) {
  return [
    { type: "input_audio_buffer.committed", item_id: `item_in_${n}` },
    { type: "response.created", response: { id: `resp_${n}` } },
    { type: "conversation.item.added", item: { id: `item_out_${n}`, role: "assistant" } },
    { type: "output_audio_buffer.started", response_id: `resp_${n}` },
    { type: "response.output_audio_transcript.delta", response_id: `resp_${n}`, delta: "Mi hijo " },
    { type: "response.output_audio_transcript.delta", response_id: `resp_${n}`, delta: "tiene fiebre." },
    { type: "response.output_audio_transcript.done", response_id: `resp_${n}`, transcript: "Mi hijo tiene fiebre." },
    {
      type: "response.done",
      response: {
        id: `resp_${n}`,
        status: "completed",
        usage: { input_token_details: { audio_tokens: 20, text_tokens: 300, cached_tokens: 100 }, output_token_details: { audio_tokens: 40, text_tokens: 10 } },
      },
    },
    { type: "output_audio_buffer.stopped", response_id: `resp_${n}` },
  ];
}

describe("RealtimeEventMapper", () => {
  it("maps a full turn to normalized events, marks and playback signals", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    m.setAudioSeconds("t1", 2.5);
    const outs = turnEvents(1).map((e) => m.handle(e, 1000));
    const events = outs.flatMap((o) => o.events);

    expect(outs.flatMap((o) => o.marks)).toEqual([{ turnId: "t1", name: "rtResponseStart", t: 1000 }]);
    expect(outs.flatMap((o) => o.playbackStarted)).toEqual(["t1"]);
    expect(outs.flatMap((o) => o.playbackEnded)).toEqual(["t1"]);
    expect(events.filter((e) => e.type === "target.partial").map((e) => (e as { text: string }).text)).toEqual(["Mi hijo ", "Mi hijo tiene fiebre."]);
    const end = events.find((e) => e.type === "turn.end");
    expect(end).toMatchObject({
      turnId: "t1",
      status: "completed",
      direction: "en-es",
      providersUsed: ["gpt-realtime"],
      usage: { sttAudioSeconds: 2.5, realtime: { inputAudioTokens: 20, outputAudioTokens: 40, cachedInputTokens: 100 } },
    });
  });

  it("attributes a late input transcript to its own turn by item_id, after the next turn started", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    turnEvents(1).forEach((e) => m.handle(e, 0));
    m.beginTurn({ ...turn("t2"), speaker: "es", source: "es", target: "en" });

    const out = m.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "item_in_1", transcript: " My son has a fever. " }, 0);
    expect(out.events).toEqual([expect.objectContaining({ type: "source.final", turnId: "t1", text: "My son has a fever.", lang: "en" })]);
  });

  it("accumulates input transcription deltas", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    m.handle({ type: "input_audio_buffer.committed", item_id: "i1" }, 0);
    m.handle({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "My son" }, 0);
    const out = m.handle({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: " has" }, 0);
    expect(out.events[0]).toMatchObject({ type: "source.partial", text: "My son has" });
  });

  it("ends playback on response.done when no audio was produced", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    m.handle({ type: "response.created", response: { id: "r1" } }, 0);
    const out = m.handle({ type: "response.done", response: { id: "r1", status: "completed" } }, 0);
    expect(out.playbackEnded).toEqual(["t1"]);
    expect(out.events.find((e) => e.type === "turn.end")).toMatchObject({ status: "empty" });
  });

  it("maps an empty commit to a neutral empty_result and ends the turn", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    const out = m.handle({ type: "error", error: { code: "input_audio_buffer_commit_empty", message: "buffer too small" } }, 0);
    expect(out.events.map((e) => e.type)).toEqual(["error", "turn.end"]);
    expect(out.events[0]).toMatchObject({ code: "empty_result", turnId: "t1" });
    expect(out.playbackEnded).toEqual(["t1"]);
  });

  it("maps a failed response and rate limits into the taxonomy", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    m.handle({ type: "response.created", response: { id: "r1" } }, 0);
    const out = m.handle(
      { type: "response.done", response: { id: "r1", status: "failed", status_details: { error: { code: "rate_limit_exceeded", message: "slow down" } } } },
      0,
    );
    expect(out.events[0]).toMatchObject({ type: "error", code: "rate_limited", turnId: "t1" });
    expect(out.events[1]).toMatchObject({ type: "turn.end", status: "failed" });
    expect(mapErrorCode("server_error")).toBe("provider_error");
  });

  it(`prunes conversation items older than the last ${CONTEXT_TURNS} turns`, () => {
    const m = mapper();
    const sent: object[] = [];
    for (let n = 1; n <= CONTEXT_TURNS + 1; n++) {
      m.beginTurn(turn(`t${n}`));
      turnEvents(n).forEach((e) => sent.push(...m.handle(e, 0).send));
    }
    expect(sent).toEqual([
      { type: "conversation.item.delete", item_id: "item_in_1" },
      { type: "conversation.item.delete", item_id: "item_out_1" },
    ]);
  });

  it("accepts the legacy transcript event names too", () => {
    const m = mapper();
    m.beginTurn(turn("t1"));
    const out = m.handle({ type: "response.audio_transcript.delta", delta: "Hola" }, 0);
    expect(out.events[0]).toMatchObject({ type: "target.partial", text: "Hola" });
  });
});

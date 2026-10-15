# Provider API facts (researched 2026-10-15)

Official docs only. Pages were read through a fetch tool that paraphrases, so re-check exact strings against the linked page before you hard-code anything security- or billing-critical.
**UNVERIFIED** marks a fact I could not confirm on an official page.

## URLs consulted
- OpenAI: https://developers.openai.com/api/docs/guides/realtime-webrtc (platform.openai.com/docs/guides/realtime-webrtc now 301-redirects here)
- https://developers.openai.com/api/docs/guides/realtime-conversations
- https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
- https://developers.openai.com/api/reference/resources/realtime/server-events
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/guides/realtime-costs
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-realtime
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create (search snippet; direct fetch 404'd)
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events (search snippet)
- https://developers.openai.com/api/docs/guides/streaming-responses
- Deepgram: https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- https://developers.deepgram.com/docs/keep-alive
- https://developers.deepgram.com/docs/finalize
- https://developers.deepgram.com/docs/close-stream
- https://developers.deepgram.com/docs/authenticating
- https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
- https://developers.deepgram.com/docs/understanding-end-of-speech-detection
- https://developers.deepgram.com/docs/models-languages-overview
- https://deepgram.com/pricing
- ElevenLabs: https://elevenlabs.io/docs/api-reference/text-to-speech/stream
- https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- https://elevenlabs.io/docs/api-reference/text-to-speech and https://elevenlabs.io/docs/api-reference/text-to-speech/convert/llms.txt
- https://elevenlabs.io/docs/models
- https://elevenlabs.io/docs/best-practices/latency-optimization
- https://elevenlabs.io/docs/api-reference/voices/search and https://elevenlabs.io/docs/api-reference/voices/get-all
- https://elevenlabs.io/docs/quickstart
- https://elevenlabs.io/pricing/api
- DeepL: https://developers.deepl.com/api-reference/translate
- https://developers.deepl.com/api-reference/translate/request-translation
- https://developers.deepl.com/docs/getting-started/auth
- https://developers.deepl.com/docs/getting-started/supported-languages
- https://developers.deepl.com/docs/best-practices/error-handling
- https://www.deepl.com/en/pro-api and https://www.deepl.com/en/pricing (neither lists API prices); support.deepl.com (403)

---

## 1. OpenAI Realtime API (GA)

**Model status (important).** `gpt-realtime` still exists. It is GA with the single snapshot `gpt-realtime-2025-08-28`, and no deprecation is shown ([model page](https://developers.openai.com/api/docs/models/gpt-realtime)). The [models list](https://developers.openai.com/api/docs/models) now features newer models: `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-live-1`, and `gpt-realtime-translate` (streaming speech-to-speech translation, worth a look for this project). `gpt-realtime-mini` is **deprecated**. The current guides use `gpt-realtime-2.1` in their samples.

### Mint an ephemeral client secret (backend)
Source: [client_secrets ref](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), [WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- `POST https://api.openai.com/v1/realtime/client_secrets`
- Headers: `Authorization: Bearer <OPENAI_API_KEY>`, `Content-Type: application/json`, optional `OpenAI-Safety-Identifier: <hashed user id>`
- Body (all fields optional):
```json
{
  "expires_after": { "anchor": "created_at", "seconds": 600 },
  "session": {
    "type": "realtime",
    "model": "gpt-realtime",
    "instructions": "...",
    "output_modalities": ["audio"],
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-4o-transcribe", "language": "en" },
        "turn_detection": null
      },
      "output": { "voice": "marin" }
    }
  }
}
```
- `expires_after.seconds` ranges from 10 to 7200 and defaults to 600. `anchor` accepts only `"created_at"`.
- `turn_detection`: `{type:"server_vad"|"semantic_vad",...}` or **`null`**. Null disables VAD, and the client must then trigger responses manually.
- `audio.input.format`: `{type:"audio/pcm", rate:24000}` (24 kHz is the only rate), `{type:"audio/pcmu"}`, or `{type:"audio/pcma"}`. Other input options: `noise_reduction` (`near_field` / `far_field` / null).
- `transcription`: an object or null, with fields `model`, `language`, `languages`, `prompt`, `keywords`, `delay`. Documented model values: `whisper-1`, `gpt-transcribe`, `gpt-live-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`.
- `output_modalities` defaults to `["audio"]`. Text and audio **cannot be requested together**. With `["audio"]` you still get the transcript events.
- Voices: `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar`, or `{ "id": "voice_..." }` for a custom voice. `marin` and `cedar` are recommended. The voice **cannot change after the model has emitted audio** ([conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations)).
- Response: `{ "value": "ek_...", "expires_at": <unix seconds>, "session": { ...applied config... } }`. Give the browser `value`.

### Browser WebRTC handshake
Source: [WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- Before creating the offer, create the data channel: `pc.createDataChannel("oai-events")`.
- `POST https://api.openai.com/v1/realtime/calls`
  - Headers: `Authorization: Bearer <ek_ value>`, `Content-Type: application/sdp`
  - Body: raw `offer.sdp`. The response body is the **SDP answer as text**, applied with `pc.setRemoteDescription({type:"answer", sdp})`.
  - The guide's sample has no `?model=` query param; the model comes from the client secret's session.
- Alternative "unified interface": the server does the exchange instead. The browser POSTs its SDP to *your* backend. The backend then POSTs `multipart/form-data` to `/v1/realtime/calls` with fields `sdp` (the offer) and `session` (session JSON string), using the standard API key, and returns the answer SDP. This keeps the key server-side with no ephemeral token.

### Push-to-talk with turn detection off (WebRTC)
Source: [conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations)
- Turn detection is off via `turn_detection: null` (session config or `session.update`).
- **Key down:** send `input_audio_buffer.clear`. If a response is in progress, send `response.cancel`. If audio is playing, send `output_audio_buffer.clear`, which "truncates the conversation as well".
- **Key up:** send `input_audio_buffer.commit`, then `response.create`.
- WebRTC caveats:
  - Mic audio flows over the media track, so there is **no** `input_audio_buffer.append` (that is WebSocket-only).
  - The input buffer "must be explicitly cleared".
  - The server manages the output audio buffer and truncates unplayed audio on interrupt.
  - `response.output_audio.delta` (audio bytes) is WebSocket-only; with WebRTC, audio arrives on the remote track.
- Committing the buffer starts input transcription, if it is enabled.

### Server events (exact strings)
Source: [server-events ref](https://developers.openai.com/api/reference/resources/realtime/server-events)
| Purpose | Event | Key fields |
|---|---|---|
| Session | `session.created`, `session.updated` | `session` |
| Input transcription (user) | `conversation.item.input_audio_transcription.delta` | `item_id`, `content_index`, `delta` |
| | `conversation.item.input_audio_transcription.completed` | `item_id`, `content_index`, `transcript`, `usage` |
| | `conversation.item.input_audio_transcription.failed`, `.segment` | |
| Output transcript (model) | `response.output_audio_transcript.delta` | `response_id`, `item_id`, `output_index`, `content_index`, `delta` |
| | `response.output_audio_transcript.done` | `...`, `transcript` |
| Text output | `response.output_text.delta` / `.done` | |
| Response lifecycle | `response.created`, `response.done`, `response.output_item.added/done`, `response.content_part.added/done` | |
| Buffer | `input_audio_buffer.committed`, `.cleared`, `.speech_started`, `.speech_stopped`, `.timeout_triggered` | |
| WebRTC/SIP only | `output_audio_buffer.started` (server starts streaming audio), `output_audio_buffer.stopped` (buffer fully drained), `output_audio_buffer.cleared` | |
| Errors | `error` | `error.{type,code,message,param,event_id}`. Usually recoverable; the session stays open. |
| Other | `conversation.item.added`, `conversation.item.done`, `rate_limits.updated` | |
- The legacy `response.audio_transcript.*` names do **not** appear in the GA reference; only `response.output_audio_transcript.*` does. I could not rule out that the server still emits the legacy names: **UNVERIFIED**.
- Match transcription events to items by `item_id`. Ordering across turns is not guaranteed ([transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)).

### Input transcription is a separate process
- The reference says input transcription "is not native to the model, since the model consumes audio directly". It "runs asynchronously through" `/audio/transcriptions`, and its output "should be treated as guidance ... rather than precisely what the model heard" ([client_secrets ref](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)).
- Billing: "Input transcription uses a different model than the speech2speech model" and is billed from a different rate card ([realtime-costs](https://developers.openai.com/api/docs/guides/realtime-costs)).
- The realtime-transcription guide recommends `gpt-live-transcribe`. It says to use `gpt-transcribe` only when you need post-commit transcription or detected-language output, and that this requires WebSocket. That guide's context, standalone transcription session versus conversation session, is ambiguous.

### Pricing (read 2026-10-15, [pricing](https://developers.openai.com/api/docs/pricing))
| Model | Audio in / cached / out (per 1M tok) | Text in / cached / out |
|---|---|---|
| gpt-realtime (and gpt-realtime-1.5) | $32 / $0.40 / $64 | $4 / $0.40 / $16 |
| gpt-realtime-2, gpt-realtime-2.1 | $32 / $0.40 / $64 | $4 / $0.40 / $24 |
| gpt-realtime-2.1-mini | $10 / $0.30 / $20 | $0.60 / $0.06 / $2.40 |
- Audio tokens: user audio is 1 token per 100 ms (about 600 per minute) and assistant audio is 1 token per 50 ms (about 1,200 per minute) ([realtime-costs](https://developers.openai.com/api/docs/guides/realtime-costs)). The per-minute figures are my arithmetic. For gpt-realtime that works out to roughly $0.019/min of input audio and $0.077/min of output audio, before context re-billing.
- Transcription: gpt-4o-transcribe ~$0.006/min, gpt-4o-mini-transcribe ~$0.003/min, gpt-transcribe ~$0.0045/min, Whisper $0.006/min.
- Text models (in / out per 1M): gpt-4o-mini $0.15/$0.60, gpt-4.1-mini $0.40/$1.60, gpt-4.1-nano $0.10/$0.40, gpt-5-mini $0.25/$2.00, gpt-5-nano $0.05/$0.40, gpt-6-luna $0.10/$0.50.

### Chat Completions streaming for translation
- Model choice: [models page](https://developers.openai.com/api/docs/models) features `gpt-6-luna` as the "most efficient" model for focused, high-volume tasks. gpt-4.1-mini, gpt-4o-mini and gpt-5-mini are still priced on the pricing page but are not featured on the models page. Whether they are still available for Chat Completions is **UNVERIFIED**, so check `GET /v1/models` with your key.
- SSE format, from search snippets of the [create ref](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [streaming-events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events):
  - `stream: true` produces data-only SSE lines `data: {"object":"chat.completion.chunk",...}`. Read text from `choices[0].delta.content`.
  - The last chunk has `finish_reason`, then the stream ends with `data: [DONE]`.
  - With `stream_options: {"include_usage": true}`, one extra chunk with empty `choices` and a `usage` object arrives before `[DONE]`. It may be missing if the stream is interrupted.
- The Responses API uses typed SSE events instead ([streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses)).

## 2. Deepgram streaming STT
Source: [listen-streaming ref](https://developers.deepgram.com/reference/speech-to-text/listen-streaming)
- URL: `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&punctuate=true&smart_format=true&endpointing=300&utterance_end_ms=1000&vad_events=true`
- Params and defaults:
  - `language`: default `en`
  - `channels`: default 1
  - `interim_results`, `punctuate`, `smart_format`, `vad_events`: default false
  - `endpointing`: listed as default `10` (ms of silence that ends an utterance and sets `speech_final`)
  - `utterance_end_ms`: requires `interim_results=true`. Use ≥ `1000` ([end-of-speech](https://developers.deepgram.com/docs/understanding-end-of-speech-detection)).
  - `encoding` values include `linear16`, `opus`, `mulaw`, etc.
- Models ([models-languages](https://developers.deepgram.com/docs/models-languages-overview)):
  - **nova-3 supports Spanish** (`es`, `es-419`) and is recommended for batch and streaming.
  - `language=multi` (code-switching) covers 10 languages, including English and Spanish.
  - The newest model is **Flux** (`flux-general-en`, `flux-general-multi`), described as the "latest-generation streaming model" with turn detection. It has its own reference ([listen-flux](https://developers.deepgram.com/reference/speech-to-text/listen-flux)), and whether it uses a different path is **UNVERIFIED**.
- Auth:
  - Server: `Authorization: Token <DEEPGRAM_API_KEY>` ([authenticating](https://developers.deepgram.com/docs/authenticating)).
  - Browser alternative: `Sec-WebSocket-Protocol: token, <KEY>`, which in JS is `new WebSocket(url, ["token", key])` ([sec-websocket-protocol](https://developers.deepgram.com/docs/using-the-sec-websocket-protocol)). It exposes the key, so prefer server-side proxying or temporary tokens (Auth API `/reference/auth/tokens/grant`). The token TTL and the format of the subprotocol value for temp tokens are **UNVERIFIED**.
- Control messages (send as **text** frames):
  - `{"type":"KeepAlive"}`: send every 3-5 s. With **no audio or KeepAlive for 10 s, the socket closes with `NET-0001`** ([keep-alive](https://developers.deepgram.com/docs/keep-alive)).
  - `{"type":"Finalize"}` (optional `"channel":0`): processes buffered audio immediately and returns final results. The final result has `"from_finalize": true`, but this is **not guaranteed when there is little or no buffered audio** ([finalize](https://developers.deepgram.com/docs/finalize)). Use a timeout fallback.
  - `{"type":"CloseStream"}`: flushes final results, sends a `Metadata` message, then closes ([close-stream](https://developers.deepgram.com/docs/close-stream)).
  - `{"type":"Configure", "keyterms":[...], "features":{...}}`: updates settings mid-stream.
- Results message:
```json
{"type":"Results","channel_index":[0,1],"start":0.0,"duration":0.0,"is_final":true,"speech_final":true,"from_finalize":false,
 "channel":{"alternatives":[{"transcript":"...","confidence":0.0,"words":[{"word":"","start":0,"end":0,"confidence":0,"punctuated_word":""}]}]},
 "metadata":{"request_id":"...","model_info":{...}}}
```
- Other server messages:
  - `Metadata`
  - `UtteranceEnd` (`{"type":"UtteranceEnd","channel":[0,1],"last_word_end":3.1}`)
  - `SpeechStarted` (needs `vad_events=true`)
  - Non-fatal `Error` (`variant`, `description`). Fatal errors close the socket instead.
- Text accumulation: `is_final` means the segment text is final, so concatenate those. `speech_final` means the endpoint was reached.
- Pricing ([deepgram.com/pricing](https://deepgram.com/pricing), read 2026-10-15, marked "limited-time promotional"), streaming pay-as-you-go:
  - Nova-3 monolingual **$0.0048/min**
  - Nova-3 multilingual **$0.0058/min**
  - Flux English $0.0065/min, Flux multilingual $0.0078/min
  - Growth tier: $0.0042 / $0.0050 / $0.0057 / $0.0068

## 3. ElevenLabs streaming TTS
Source: [stream ref](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
- `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000`
- Headers: `xi-api-key: <key>`, `Content-Type: application/json`
- Query params:
  - `output_format`: default `mp3_44100_128`. Values: `pcm_8000|16000|22050|24000|32000|44100|48000`, `mp3_*`, `opus_48000_*`, `ulaw_8000`, `alaw_8000`. PCM at 44.1 kHz needs the Pro tier.
  - `optimize_streaming_latency`: **deprecated**
  - `enable_logging`
- Body: `{ "text": "...", "model_id": "eleven_flash_v2_5", "language_code": "es", "voice_settings": {...} }`
  - `model_id` defaults to `eleven_multilingual_v2`.
  - `language_code` is ISO 639-1. It is ignored if the model does not support it, and is not supported on multilingual_v2.
  - Other fields: `previous_text`, `next_text`, `seed`, `apply_text_normalization` (`auto|on|off`).
- Response: 200 with a chunked audio byte stream; 422 for a validation error.
- `pcm_24000` = raw signed 16-bit little-endian (S16LE), 24 kHz, no header. This comes from search snippets of elevenlabs.io docs pages (TTS reference, STT realtime guide, LiveKit guide). The fetched stream page does not state the encoding, so treat it as **partly verified**. Mono is assumed and not stated: **UNVERIFIED**.
- Models ([models](https://elevenlabs.io/docs/models)):
  - **`eleven_flash_v2_5`**: ~75 ms model latency, lowest listed. It supports all Multilingual v2 languages, **including Spanish**. 40k-character limit.
  - `eleven_turbo_v2_5`: deprecated.
  - Newer models: `eleven_v4`, `eleven_v4_turbo` (~100 ms, which the low-latency guide points to for real-time use), `eleven_v3`, `eleven_v3_conversational`.
- WebSocket: `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=...&output_format=...` ([stream-input](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input))
  - Auth: `xi-api-key` header, `authorization` or `single_use_token` query param, or the key in the first message.
  - Message sequence:
    1. First message is `{"text":" ", "voice_settings":{...}}`.
    2. Then `{"text":"chunk ", "try_trigger_generation":false, "flush":false}`.
    3. Close with `{"text":""}`.
  - Server sends `{"audio":"<base64>", "normalizedAlignment":{...}, "alignment":{...}}`, then `{"isFinal":true}`.
  - Other params: `inactivity_timeout` (default 20, max 180), `auto_mode`.
- **Which is lower latency for short known sentences: HTTP streaming.** The docs say to prefer HTTP "when the full text is available upfront" because WebSocket buffering can add latency. Use WebSocket for LLM token streams or alignment ([latency guide](https://elevenlabs.io/docs/best-practices/latency-optimization), [stream-input](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)).
- Regional host: US-pinned base URL `https://api.us.elevenlabs.io`. Check the `x-region` response header to see which backend served the request.
- Voices:
  - `GET https://api.elevenlabs.io/v2/voices` returns `{voices:[{voice_id,name,category:"premade"|...}], has_more, next_page_token}` ([voices/search](https://elevenlabs.io/docs/api-reference/voices/search)).
  - `/v1/voices` is not documented on the pages fetched: **UNVERIFIED**.
  - Default voice used in the quickstart: **`JBFqnCBsd6RMkjVDRZzb` ("George")** ([quickstart](https://elevenlabs.io/docs/quickstart)). No official list of default voice IDs was found, so pick one from `/v2/voices` with `category=premade`. That other premade IDs (e.g. `21m00Tcm4TlvDq8ikWAM`) still work is **UNVERIFIED**.
- Pricing ([pricing/api](https://elevenlabs.io/pricing/api), read 2026-10-15):
  - **Flash/Turbo $0.04 per 1K characters**; v3 $0.08 per 1K.
  - Plans: Free 20k Flash characters, Starter $6, Creator $22, Pro $99, Scale $299, Business $990.
  - Whether overage is billed at the same rate is not stated: **UNVERIFIED**. Flash is "50% lower price per character" ([models](https://elevenlabs.io/docs/models)).

## 4. DeepL API
Sources: [translate ref](https://developers.deepl.com/api-reference/translate), [auth](https://developers.deepl.com/docs/getting-started/auth)
- Base URL: Free keys end in **`:fx`** and use `https://api-free.deepl.com`. Pro keys use `https://api.deepl.com`.
- Header: `Authorization: DeepL-Auth-Key <key>`
- `POST /v2/translate` with a JSON body (`application/json`, or form-urlencoded):
```json
{ "text": ["Hola, ¿cómo está?"], "source_lang": "ES", "target_lang": "EN-US",
  "context": "Medical interpreting session...", "model_type": "latency_optimized" }
```
- Response: `{ "translations": [ { "detected_source_language": "ES", "text": "..." } ] }`
  - `billed_characters` appears only if `show_billed_characters` is true.
  - `model_type_used` appears only if `model_type` was sent.
- Language codes ([supported-languages](https://developers.deepl.com/docs/getting-started/supported-languages)):
  - EN→ES: `source_lang:"EN"`, `target_lang:"ES"` (or `ES-419` for Latin American Spanish).
  - ES→EN: `source_lang:"ES"`, `target_lang:"EN-US"`.
  - `EN-US`, `EN-GB` and `ES-419` are target-only. Bare `EN` is listed without a deprecation note, but older guidance deprecated it as a target, so use `EN-US`. That old deprecation is **UNVERIFIED** on current docs.
- `context`: "influence[s] a translation but is not translated itself". Its characters are **not billed**.
- `model_type`: `quality_optimized`, `prefer_quality_optimized` or `latency_optimized`. Other options: `formality`, `glossary_id`, `custom_instructions`.
- Request limit: 128 KiB per request (413 if exceeded).
- **Streaming:** none for text `/v2/translate`. Real-time streaming exists only in the separate WebSocket **Voice API**.
- Errors ([error-handling](https://developers.deepl.com/docs/best-practices/error-handling)):
  - **429** = too many requests. Retry with exponential backoff and honour `Retry-After`.
  - **456** = usage limit reached (character quota, cost-control limit or glossary limit). **Do not retry.**
  - 403 = auth or scope. 413 = too large. 5xx/529 = retry with backoff.
  - Log `X-Trace-ID`.
- **Pricing: UNVERIFIED.** The official pricing pages did not expose API rates, and support.deepl.com returned 403. Search snippets indicate:
  - "DeepL API Pro" (base fee plus per-character billing) and the 500k-characters/month Free plan **can no longer be purchased**.
  - Current plans are Developer (one-time 1M characters), Growth (1M characters/month included, then overage, 50M/month cap) and Enterprise.
  - The figure of roughly $25 per 1M characters for legacy Pro is from memory only and is **UNVERIFIED**.
  - Existing `:fx` keys reportedly still work.

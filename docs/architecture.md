# Architecture

## 1. Components

```
Browser (Vite + React + TS)
  UI (mode-agnostic)
    Header, speakers, transcripts, latency panel, error states
  SessionStore
    Session + turn state machines; transcript history; metrics
  AudioEngine (shared by both modes)
    Input source: Microphone | Replay WAV
    CaptureWorklet -> PCM16 16 kHz mono, 20 ms frames
    EnergyDetector -> speech start / speech end (T0) marks
    PTT gate: capture is muted unless a speaker holds the floor
    PlaybackWorklet + OutputTap -> "first audible" mark
    DenyTone (Web Audio oscillator, routed to destination directly, never through OutputTap)
  InterpreterTransport (interface)
    RealtimeTransport: WebRTC to OpenAI + data channel events
    CascadeTransport: WebSocket /ws/cascade

ASP.NET Core backend (one process)
  Api
    POST /api/realtime/session   -> short-lived client secret + session config
    GET  /api/health             -> provider config status (names missing vars, never values)
    WS   /ws/cascade             -> cascade session
    Startup: DotNetEnv loads .env (repo root) before configuration is built;
    real environment variables take precedence over .env
  Control module
    CascadeSession: turn lifecycle, per-turn CancellationTokenSource,
    single writer task per socket
  Media module (pipeline)
    STT stage -> CommitPolicy -> Translation stage -> TTS stage
    Stages are connected by bounded System.Threading.Channels
  Providers
    Deepgram STT, OpenAI translation, DeepL translation, ElevenLabs TTS
    (+ fakes for tests)
  Resilience
    Per-stage timeouts, Polly retry with jitter, circuit breaker failover
  Telemetry
    Stopwatch stage durations, emitted as stage.timing events
```

## 2. Backend contracts (C#)

```csharp
public interface ISttProvider {
    IAsyncEnumerable<SttResult> TranscribeAsync(ChannelReader<AudioFrame> audio, SttOptions opts, CancellationToken ct);
}
public interface ICommitPolicy {          // pure, no I/O
    IReadOnlyList<Segment> Accept(SttResult result);
    IReadOnlyList<Segment> Flush();       // called at end of turn
}
public interface ITranslationProvider {
    IAsyncEnumerable<string> TranslateAsync(Segment segment, TranslationContext ctx, CancellationToken ct);
}
public interface ITtsProvider {
    IAsyncEnumerable<AudioChunk> SynthesizeAsync(string text, VoiceOptions voice, CancellationToken ct);
}
```

**Provider selection** comes from config, overridable per session from the
UI's run conditions:

```json
"Providers": { "Stt": "deepgram", "Translation": "openai", "TranslationFallback": "deepl", "Tts": "elevenlabs" }
```

## 3. Normalized event schema (shared by both transports)

Every event carries `turnId` and `t` (a monotonic timestamp, browser or server
side as noted).

| type | payload |
|---|---|
| `session.ready` | mode, providers, strategy |
| `turn.start` / `turn.end` | speaker (`en` or `es`), direction |
| `source.partial` / `source.final` | text, lang |
| `target.partial` / `target.final` | text, lang |
| `audio.chunk` | PCM16 24 kHz (cascade downstream) |
| `stage.timing` | stage (`stt_final`, `translate_first_token`, `translate_done`, `tts_first_byte`), durationMs |
| `floor.denied` | speaker (log only, not a tracked metric) |
| `error` | code (taxonomy), message, retryable, provider? |

Define these as C# records. Generate the TS types from them, or hand-maintain
the TS types with a contract test that round-trips sample events from both
sides.

## 4. State machines

**Turn / floor (browser, authoritative):**
`Warming -> Ready -> Capturing(speaker) -> Finalizing -> Playing -> Ready`

- `Error` can be entered from any state, and returns to `Ready` on recovery.
- A press in `Capturing`, `Finalizing`, or `Playing` produces `floor.denied`:
  a tone, a shake, and a "Floor busy" label. The state does not change.
- A press in `Warming` or `Error` is rejected, with "Not ready" styling.
- A mode switch is accepted only in `Ready`. Otherwise it is queued and
  applied when the turn returns to `Ready`.

**Session:** `Idle -> Warming -> Ready -> Closed`, plus `Error`.

**Cascade turn pipeline (server):**
`Streaming -> Draining -> Completed | Cancelled | Failed`

**Transport connection:** `Connecting -> Connected -> Reconnecting(n of 5) -> Failed`

Unit-test the turn and floor machine with table-driven tests (vitest).

## 5. Realtime mode details (verify against current OpenAI docs)

- **Session config** comes from the backend:
  - model `gpt-realtime`
  - voice
  - turn detection off (push-to-talk)
  - input transcription on, if supported
  - strict interpreter instructions
- **Instructions:** "You are a professional interpreter. Translate everything
  the speaker says from {source} to {target}. Never answer, comment, or add
  content. Output only the translation, spoken."
- **On release:** commit the input buffer and request a response, using the
  manual turn flow from the docs.
- **Event mapping** from data channel events to the normalized schema:
  - input transcription -> `source.*`
  - output transcript -> `target.*`
  - response start -> the "RT response" mark
- **Detect** "answered instead of interpreted" in the evaluation harness
  (section 8).
- **Source transcript timing:** Realtime's input transcription may arrive
  after the interpreted audio. Show it when it arrives. Never delay the
  target to line the columns up.

## 5a. Warm-up

- **On page load and after a mode switch:**
  - Realtime: mint a session and open WebRTC.
  - Cascade: open the WebSocket, and have the server pre-connect its provider
    clients.
  - Until this completes, the turn state is `Warming` and the talk buttons
    show "Not ready".
- **On press (press-to-warm):** the cascade opens the STT stream immediately.
  Finalize on release.

## 6. Cascade details

- **STT:** stream frames as they arrive. Use the provider's interim and final
  results. On release, send the provider's finalize or flush message if it
  has one.
- **CommitPolicy:**
  - `segment` commits finalized segments.
  - `clause` commits stable partial text at clause punctuation or
    conjunction boundaries, never re-sending committed text.
- **Translation:** stream tokens. Pass the last 2 committed segments as
  context. **Translation controls** (formal register + clinic glossary,
  `TranslationControls` in appsettings.json, on by default, `?controls=off`
  per session) travel on each turn: DeepL applies them as `formality` and a
  multilingual glossary, the OpenAI translator and the Realtime session as
  prompt instructions. See [translation-controls.md](translation-controls.md).
- **TTS:** synthesize per committed translation; stream the chunks.
  - The browser buffers the audio until release (consecutive playback),
    then plays immediately.
- **Timeouts** (configurable): STT final 2.0 s after release, translation
  first token 2.0 s, TTS first byte 2.0 s. On timeout: one retry, then a
  `provider_timeout` error on the turn.
- **429s:** retry with jitter (max 3). Then the circuit breaker opens for
  60 s, translation fails over to DeepL, and the failover is recorded on the
  turn.

## 7. Timing marks (per turn)

| Mark | Captured where |
|---|---|
| press | browser, pointerdown |
| access | browser: first frame accepted by the transport (cascade: WS send; realtime: track live) |
| T0 speech end | browser energy detector: last voiced frame |
| release | browser, pointerup |
| stt_final (final segment) | server duration, mapped onto the browser timeline on receipt |
| translate_first_token / translate_done | server duration |
| tts_first_byte | server duration |
| rt_response_start | browser, data channel event |
| first_audible | browser: playback tap (cascade) / AnalyserNode on remote track (realtime) |

**Headline metric:** mouth-to-ear latency (3GPP KPI 3, adapted) =
`first_audible - T0`.

**Access time** (3GPP KPI 1) = `access - press`.

Each turn also records its run conditions: mode, strategy, providers,
direction, and input source.

## 8. Evaluation

**Clips (synthetic):**
- Write 12 EN and 12 ES clinic-style sentences (see `docs/ui-spec.md` for
  examples), with reference transcripts and reference translations, in
  `harness/scripts.json`.
- Generate the WAVs once with a TTS provider, then cache them in
  `harness/clips/`.
- Note in the write-up that synthetic speech is cleaner than human speech.

**Replay:**
- In-app: the Input selector plays a WAV through the same capture path, with
  a PTT press and release automated around it.
- Automated: Playwright runs Chromium with these flags:
  - `--use-fake-ui-for-media-stream`
  - `--use-fake-device-for-media-stream`
  - `--use-file-for-fake-audio-capture=<wav>`

**Runs:** each clip through four configurations. Results go to
`harness/results/*.json`.
- Realtime
- Cascade-segment
- Cascade-clause
- Cascade-segment with DeepL as the primary translator. This is the provider
  flexibility evidence: the only change is config.

**Automated quality rubric:**
- An LLM judge (OpenAI, temperature 0) scores each target against the source
  and the reference translation, 1-5, on three axes: accuracy,
  completeness, and fluency.
- Label it "automated judge" in the report.
- MORNING.md includes a short human scoring sheet so the user can spot-check
  10 turns.

**Language-pair onboarding exercise:**
- After the core runs pass, add English <-> French using config plus
  2 clips per direction.
- Record the files touched and the elapsed effort for each architecture.
- Keep EN <-> ES as the default pair in the UI selector.

**Report** (`npm run report`, TypeScript):
- p50/p95 of each mark difference, per mode and strategy.
- Word error rate: word-level Levenshtein, implemented in TS:
  - source side: cascade STT vs. the reference transcript;
  - target side: both modes vs. the reference translation (a crude proxy;
    label it as such).
- An "answered instead of interpreted" flag: the target is a question
  answer or adds content (heuristic plus manual review list).
- Cost per minute: usage logged per turn (audio seconds, tokens, characters)
  times `harness/pricing.json`. Mark prices "verify" with a date.

**Soak:** loop clips for 5 minutes per mode. Record disconnects, playback
buffer depth over time, and browser heap at start vs. end. Also force one
transport drop mid-soak, and measure recovery time: drop -> Ready, with the
transcript intact.

## 9. Repo layout

```
/client                      Vite + React + TS
  src/audio/                 capture, playback, energy detector, deny tone, replay
  src/transports/realtime/   WebRTC transport + event mapping
  src/transports/cascade/    WebSocket transport
  src/state/                 session + turn machines, metrics store
  src/ui/                    components per docs/ui-spec.md
  public/boostlingo-logo.png
/server
  Workbench.sln
  src/Workbench.Api/         endpoints, DI, config
  src/Workbench.Core/        contracts, events, commit policy, orchestrator
  src/Workbench.Providers/   adapters + fakes
  tests/Workbench.Tests/     xUnit
/e2e                         Playwright tests
/harness                     scripts.json, clips/, results/, pricing.json, report.ts
/docs                        brief, architecture, ui-spec, design, comparison.md
package.json                 root scripts: dev, test, e2e, report
README.md  CLAUDE.md  PROGRESS.md  MORNING.md
```

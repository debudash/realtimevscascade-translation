# Sequence diagrams (as built)

Source: as built at commit fdc469c (code last changed in 7e168f9).

Related: [hla.md](hla.md) (high-level architecture) and [lla.md](lla.md) (low-level architecture).

These diagrams describe what the code does, not the pre-build plan in
[../architecture.md](../architecture.md). Where the two differ, a "Differs from the
pre-build spec" line says so.

**Clocks.** Browser marks are `performance.now()` milliseconds. The server never
sends absolute times for marks: it sends `stage.timing` events carrying a
`System.Diagnostics.Stopwatch` duration, and the browser stores the duration and
sets the mark to the browser time the event arrived (`receivedAt`). Mark names
below use the wire names (`stt_final`); the client stores them in camelCase
(`sttFinal`) in `client/src/state/metrics.ts`.

Contents:

1. [Warm-up](#1-warm-up)
2. [Realtime client-secret mint and WebRTC connect](#2-realtime-client-secret-mint-and-webrtc-connect)
3. [A Realtime turn](#3-a-realtime-turn)
4. [A cascade turn, segment commit](#4-a-cascade-turn-segment-commit)
5. [Clause-commit variant](#5-clause-commit-variant)
6. [Floor deny](#6-floor-deny)
7. [Mid-session mode switch](#7-mid-session-mode-switch)
8. [429 retry and DeepL failover](#8-429-retry-and-deepl-failover)
9. [Provider timeout](#9-provider-timeout)
10. [Socket drop and reconnect](#10-socket-drop-and-reconnect)
11. [Timing marks reference](#timing-marks-reference)

## 1. Warm-up

```mermaid
sequenceDiagram
    participant App as App.tsx
    participant C as Controller
    participant API as Backend API
    participant AE as Audio engine
    participant T as CascadeTransport
    participant S as CascadeSession
    participant P as Provider APIs

    App->>C: start() (idempotent)
    Note over C: phase Warming, talk buttons show Not ready
    par config
        C->>API: GET /api/health
        API-->>C: missing key names, missingByMode
    and
        C->>API: GET /api/config
        API-->>C: pairs, languages, providers, translationControls
    and
        C->>API: GET /api/clips
        API-->>C: replay clip list (empty on failure)
    end
    C->>AE: capture.init() and player.init() (load worklets)
    C->>AE: selectInput(mic) getUserMedia
    alt mic blocked
        AE-->>C: MicDeniedError
        C->>C: sessionError mic_denied, ERROR
    end
    alt keys missing for this mode
        C->>C: failSession config_error (panel names the variable)
    else keys present
        C->>C: warm(mode): close old transport, connection Connecting
        C->>T: connect()
        T->>S: open WebSocket /ws/cascade
        T->>S: session.configure (pairId, strategy, providers, faults, controls)
        S->>S: Resolve providers, check MissingKeys and UnknownProviders
        alt key missing or unknown provider
            S-->>T: error config_error
            T-->>C: connect() rejects, failSession config_error
        else configured
            S->>S: factory.Create wraps translation and TTS in resilience
            par best-effort warm-up, 5 s cap
                S->>P: Deepgram GET /v1/projects
            and
                S->>P: OpenAI GET /v1/models/(translation model)
            and
                S->>P: DeepL GET /v2/usage
            and
                S->>P: ElevenLabs GET /v1/models
            end
            S-->>T: session.ready (mode, providers, strategy)
            T-->>C: connection Connected, event session.ready
            C->>C: dispatch WARM_DONE, Warming to Ready
            Note over C: talk buttons show Hold to talk
        end
    end
```

`App.tsx` calls `controller.start()` once. It loads health, config and clips in
parallel, initializes both audio contexts, opens the mic, then calls `warm(mode)`.
The cascade transport resolves only on `session.ready` (client cap 15 s, else
`provider_timeout`). Server warm-up opens pooled HTTP/TLS connections and checks
keys. It does not open the Deepgram stream, which opens on press (diagram 4).
`KeepWarmLoopAsync` repeats the warm-up after 45 s idle. Realtime warm-up is
diagram 2. A mode switch reuses `warm()` (diagram 7).

## 2. Realtime client-secret mint and WebRTC connect

```mermaid
sequenceDiagram
    participant C as Controller
    participant RT as RealtimeTransport
    participant API as Backend API
    participant OA as OpenAI

    C->>RT: connect()
    RT-->>C: connection Connecting
    RT->>API: POST /api/realtime/session (pairId, controls)
    API->>API: build both direction prompts (InterpreterPrompt.For)
    API->>OA: POST /v1/realtime/client_secrets with server API key
    Note over API,OA: session type realtime, model gpt-realtime, output audio, turn_detection null, input transcription on
    alt 429, 401 or other failure
        OA-->>API: error
        API-->>RT: typed error body (rate_limited or provider_error)
        RT-->>C: connect() rejects, failSession
    else ok
        OA-->>API: value (ephemeral secret), expires_at
        API-->>RT: clientSecret, model, voice, transcriptionModel, directions
    end
    RT->>RT: new RTCPeerConnection, addTrack(gated capture track)
    RT->>RT: createDataChannel oai-events
    RT->>RT: createOffer, setLocalDescription
    RT->>OA: POST /v1/realtime/calls (SDP offer, Bearer ephemeral secret)
    OA-->>RT: SDP answer
    RT->>RT: setRemoteDescription(answer)
    OA-->>RT: remote audio track (ontrack, 10 s cap)
    OA-->>RT: data channel open (10 s cap)
    RT->>RT: attach stream to audio element and RemoteAudioTap
    RT-->>C: connection Connected
    RT-->>C: synthetic session.ready (providers all gpt-realtime)
    C->>C: dispatch WARM_DONE, Ready
```

The API key stays on the server. `RealtimeSessionClient.CreateAsync` mints the
secret with the first direction's prompt, and returns both directions' prompts so
the browser can retarget per press. The browser then does the SDP exchange directly
with OpenAI. Playback goes through an `<audio>` element. The `RemoteAudioTap`
AnalyserNode only listens.

## 3. A Realtime turn

```mermaid
sequenceDiagram
    actor U as Speaker
    participant C as Controller
    participant CE as CaptureEngine
    participant ED as EnergyDetector
    participant RT as RealtimeTransport
    participant OA as OpenAI Realtime
    participant TAP as RemoteAudioTap

    U->>C: pointerdown, press(en)
    C->>C: PRESS, Ready to Capturing, effect startTurn
    Note over C: press (performance.now)
    C->>CE: setGate(true), gated track now carries mic audio
    C->>RT: startTurn(turnId, en to es)
    opt a response is still active
        RT->>OA: response.cancel, output_audio_buffer.clear
    end
    RT->>OA: session.update (direction instructions, transcription language)
    RT->>OA: input_audio_buffer.clear
    Note over RT: access (performance.now at press, track already live)
    loop while held
        CE->>OA: mic audio on the WebRTC track
        CE->>C: 20 ms PCM frame from capture worklet
        C->>ED: push(frame)
        Note over C: speechStart (first voiced run, frame clock)
    end
    U->>C: pointerup, release(en)
    C->>C: RELEASE, Capturing to Finalizing
    C->>CE: setGate(false)
    Note over C: release (performance.now)
    C->>C: feed in-flight frames, up to 80 ms
    Note over C: T0 = min(lastVoicedEnd, release)
    C->>RT: release(turnId)
    RT->>TAP: arm(), poll every 5 ms
    RT->>OA: input_audio_buffer.commit
    RT->>OA: response.create (direction instructions)
    Note over RT: 5 s timer waits for response.created
    OA-->>RT: input_audio_buffer.committed (item mapped to turn)
    OA-->>RT: response.created
    Note over RT: rt_response_start (performance.now on receipt)
    OA-->>RT: conversation.item.added (assistant item tracked)
    loop output transcript
        OA-->>RT: response.output_audio_transcript.delta
        RT->>C: target.partial
    end
    OA-->>RT: output_audio_buffer.started
    RT->>C: playbackStarted, PLAYBACK_START, Finalizing to Playing
    OA->>TAP: model audio on the remote track
    TAP->>RT: peak at or above 0.01
    Note over TAP: first_audible (performance.now in poll)
    par side transcription, any time after commit
        OA-->>RT: conversation.item.input_audio_transcription.delta
        RT->>C: source.partial
        OA-->>RT: conversation.item.input_audio_transcription.completed
        RT->>C: source.final
    end
    OA-->>RT: response.output_audio_transcript.done
    RT->>C: target.final
    OA-->>RT: response.done (status, usage)
    RT->>C: turn.end (completed, empty, cancelled or failed)
    RT->>OA: conversation.item.delete for items older than the last 2 turns
    alt normal
        OA-->>RT: output_audio_buffer.stopped
    else stopped event missed
        TAP->>RT: 700 ms of silence after response.done
    end
    RT->>C: playbackEnded
    C->>C: turn.end and playback both done, TURN_DONE, Ready
```

The mic track is attached to the peer connection for the whole session. Push-to-talk
works by opening and closing a GainNode gate in `CaptureEngine`, not by toggling
`track.enabled`. Commit and `response.create` are sent from `completeRelease`, up
to 80 ms after pointerup. `eventMapper.ts` maps data-channel events and prunes
context to `CONTEXT_TURNS = 2`. The source transcript comes from the side
transcription model and may land after the audio.

## 4. A cascade turn, segment commit

```mermaid
sequenceDiagram
    actor U as Speaker
    participant C as Controller
    participant PW as Player worklet
    participant CT as CascadeTransport
    participant S as CascadeSession
    participant PL as Turn pipeline
    participant DG as Deepgram
    participant OAI as OpenAI Chat
    participant EL as ElevenLabs

    U->>C: pointerdown, press(en)
    Note over C: press (performance.now)
    C->>PW: reset()
    C->>CT: startTurn(turnId, en to es)
    CT->>S: turn.start (JSON)
    S->>PL: new CascadeTurnPipeline, RunAsync
    PL-->>CT: turn.start
    PL->>DG: open wss /v1/listen (press-to-warm, 3 s connect cap, 2 retries)
    loop while held
        C->>CT: sendFrame(PCM16 16 kHz, 20 ms)
        Note over CT: access (first frame sent, performance.now)
        CT->>S: binary frame
        S->>PL: WriteAudioAsync (bounded channel)
        PL->>DG: binary audio
        DG-->>PL: interim Results
        PL-->>CT: source.partial
        DG-->>PL: final Results (300 ms endpointing)
        PL-->>CT: source.final
        PL->>PL: SegmentCommitPolicy.Accept commits the final
        PL-->>CT: segment.commit (index, text)
        PL->>OAI: POST /v1/chat/completions stream, last 2 segments as context
        OAI-->>PL: first token
        PL-->>CT: stage.timing translate_first_token (Stopwatch from segment start)
        Note over C: translate_first_token = receipt time
        OAI-->>PL: more tokens
        PL-->>CT: target.partial (per token)
        PL-->>CT: stage.timing translate_done
        PL->>EL: POST /v1/text-to-speech/(voice)/stream pcm_24000
        EL-->>PL: first PCM bytes
        PL-->>CT: stage.timing tts_first_byte
        Note over C: tts_first_byte = receipt time
        PL-->>CT: audio.chunk (base64 PCM16 24 kHz)
        CT->>PW: push(samples), buffered, not playing
    end
    U->>C: pointerup, release(en)
    Note over C: release (performance.now)
    C->>C: feed in-flight frames, up to 80 ms
    Note over C: T0 = min(lastVoicedEnd, release)
    C->>CT: release(turnId)
    CT->>S: turn.release
    CT->>PW: play(), arms OutputTap
    S->>PL: Release(), Streaming to Draining, start release Stopwatch
    PL->>DG: Finalize (only if audio was sent)
    PW-->>C: started (buffer at 60 ms or complete), PLAYBACK_START
    PW->>PW: OutputTap finds first sample above 0.01
    Note over PW: first_audible (ctxTime mapped by getOutputTimestamp)
    DG-->>PL: final Results, from_finalize
    PL-->>CT: source.final
    PL-->>CT: stage.timing stt_final (ms since release)
    Note over C: stt_final = receipt time
    PL->>PL: commit remainder, translate, synthesize as above
    PL-->>CT: audio.chunk (last segments)
    PL-->>CT: target.final
    PL-->>CT: turn.end (status, usage, providersUsed)
    CT->>PW: end()
    CT->>C: turn.end, ended flag set
    PW-->>C: drained, playbackEnded
    C->>C: TURN_DONE, Ready
```

`CascadeTurnPipeline` runs STT, translation and TTS as three tasks joined by bounded
channels, so translated audio for early segments is already in the browser's jitter
buffer at release. `stt_final` is emitted only for finals that arrive after release.
Deepgram's stream ends when a final covers all audio sent, or after 1.5 s of quiet
after release. Stage marks take the receipt time of the latest segment's event.

Note: playback starts at `completeRelease` (up to 80 ms after pointerup), once the
worklet holds 60 ms of audio or the turn's audio is complete. CLAUDE.md says "on
button release". This is the as-built meaning.

## 5. Clause-commit variant

```mermaid
sequenceDiagram
    participant DG as Deepgram
    participant STT as Pipeline STT stage
    participant CP as ClauseCommitPolicy
    participant TR as Translation and TTS stages
    participant CT as CascadeTransport

    DG-->>STT: interim "my head hurts, and"
    STT-->>CT: source.partial
    STT->>CP: Accept(interim)
    CP->>CP: no previous interim, stable prefix is 0 words
    CP-->>STT: no commit
    DG-->>STT: interim "my head hurts, and I feel"
    STT-->>CT: source.partial
    STT->>CP: Accept(interim)
    CP->>CP: stable prefix is "my head hurts, and"
    CP->>CP: boundary after "hurts," (comma, 3 words minimum)
    CP-->>STT: Segment 0 "my head hurts,"
    STT-->>CT: segment.commit 0
    STT->>TR: segment 0
    TR-->>CT: translate_first_token, target.partial, audio.chunk
    Note over CT: translation starts before Deepgram finalizes
    DG-->>STT: final "My head hurts, and I feel dizzy."
    STT-->>CT: source.final
    STT->>CP: Accept(final)
    CP->>CP: AlignCommitted finds "hurts" and skips committed words
    CP-->>STT: Segment 1 "and I feel dizzy."
    STT-->>CT: segment.commit 1
    STT->>TR: segment 1 with segment 0 as context
```

`ClauseCommitPolicy` treats the word prefix unchanged between two consecutive
interims as stable. It commits at `, ; :` (3 words minimum), at `. ? !`, or before
a stable conjunction (EN, ES and FR lists). Committed words are never re-sent. A
later STT revision of committed words is not re-translated. The strategy is set per
session by `session.configure`. Changing it re-warms the transport.

## 6. Floor deny

```mermaid
sequenceDiagram
    actor B as Second speaker
    participant TB as TalkButton
    participant C as Controller
    participant TM as turnReducer
    participant PL as Player context
    participant ED as EnergyDetector

    Note over C: speaker A holds the floor (Capturing, Finalizing or Playing)
    B->>TB: pointerdown on the other button
    TB->>C: press(es)
    C->>TM: PRESS(es)
    TM-->>C: state unchanged, effect floorDenied
    C->>PL: denyTone()
    PL->>PL: two oscillators 660 then 440 Hz, 230 ms, gain 0.06, to ctx.destination
    Note over PL: bypasses the playback worklet and OutputTap, never first_audible
    C->>C: denyToneWindow = now to now + 350 ms
    C->>C: console.info floor.denied (log only)
    C->>TB: snapshot denied = es for 1.4 s
    TB->>TB: caption Floor busy, CSS shake 0.4 s
    loop capture frames during the window
        C->>C: frame overlaps window, skip ED.push
        Note over ED: T0 cannot land on the tone
    end
```

The reducer returns `floorDenied` for any press while the phase is busy, and the
state does not change. The owner's own repeat press while Capturing is ignored, and
a press in Warming or Error gets the "Not ready" flash instead. Frames inside the
deny window still go to the transport and the retry buffer. They are only kept out
of the energy detector.

Differs from the pre-build spec: no `floor.denied` event is sent or recorded. The
type exists in both contracts, but the press is only logged to the console.

## 7. Mid-session mode switch

```mermaid
sequenceDiagram
    actor U as User
    participant C as Controller
    participant TM as turnReducer
    participant BN as PendingSwitchBanner
    participant OT as Old transport
    participant NT as New transport

    Note over C: turn in progress in cascade mode
    U->>C: switchMode(realtime)
    C->>TM: SWITCH_MODE(realtime)
    TM-->>C: pendingMode realtime, effect switchQueued (no-op)
    C->>BN: show Switching to Realtime after this turn, Stay on Cascade
    opt user clicks Stay on Cascade
        U->>C: stayOnCurrent()
        C->>TM: CANCEL_SWITCH, pendingMode cleared
    end
    OT-->>C: turn.end and playbackEnded
    C->>TM: TURN_DONE
    alt pendingMode set
        TM-->>C: Warming, mode realtime, effect applyMode
        C->>C: warm(realtime), transportGen bumped
        C->>OT: close()
        C->>NT: connect() (diagram 2)
        NT-->>C: Connected
        C->>TM: WARM_DONE, Ready
    else switch cancelled
        TM-->>C: Ready in cascade
    end
```

While busy, `SWITCH_MODE` only records `pendingMode`. `backToReady` applies it when
the turn finishes. `transportGen` makes signals from the old transport stale. The
metrics store is not cleared, so transcripts survive the switch.

Differs from the pre-build spec: a switch also applies at once in Warming, and in
Error when the code is `internal` or `config_error` (to escape a mode that cannot
start). Other errors queue the switch.

## 8. 429 retry and DeepL failover

```mermaid
sequenceDiagram
    participant PL as Turn pipeline
    participant RTP as ResilientTranslationProvider
    participant CB as FailoverCircuit
    participant OAI as OpenAI Chat
    participant DL as DeepL
    participant CT as CascadeTransport
    participant C as Controller

    PL->>RTP: TranslateAsync(segment)
    RTP->>CB: IsOpen?
    alt circuit already open
        RTP->>PL: meter.ReportFailover (circuit open after repeated 429s)
        RTP->>DL: POST /v2/translate
    else circuit closed
        loop Polly retry, up to 3 retries
            RTP->>OAI: POST /v1/chat/completions stream
            OAI-->>RTP: 429, RateLimitedException
            RTP->>RTP: exponential backoff from 200 ms with jitter
        end
        RTP->>CB: Trip(60 s)
        RTP->>PL: meter.ReportFailover (429 4 times, circuit open for 60 s)
        RTP->>DL: POST /v2/translate (formality, glossary when controls on)
    end
    PL-->>CT: provider.failover (stage, from openai, to deepl, reason)
    CT->>C: provider.failover
    C->>C: toast Translation provider busy, failoverNote on the turn
    DL-->>RTP: translation
    RTP-->>PL: tokens
    PL-->>CT: stage.timing translate_first_token (provider deepl)
    Note over C: translate_first_token = receipt time
    PL-->>CT: stage.timing translate_done (provider deepl)
    PL-->>CT: turn.end (providersUsed includes deepl, failoverNote)
    CT->>C: turn.end, card shows Failover note
```

Retries happen only before the first token. `StartedStream` wraps "open the stream
and get the first item", so nothing has gone downstream yet. The retry predicate
also covers retryable 5xx. `TurnMeter.ReportFailover` reports only the first
failover of a turn. The circuit is shared per real provider across sessions, so
later segments and turns go straight to DeepL for 60 s.

Differs from the pre-build spec: only translation has a breaker and failover. TTS
has the same Polly retry but no fallback. STT is not wrapped in Polly: Deepgram's
connect has its own 2-retry jittered loop.

## 9. Provider timeout

```mermaid
sequenceDiagram
    participant C as Controller
    participant CT as CascadeTransport
    participant PL as Turn pipeline
    participant RTP as ResilientTranslationProvider
    participant OAI as OpenAI Chat
    actor U as User

    PL-->>CT: segment.commit 0
    PL->>RTP: TranslateAsync(segment 0)
    loop Polly timeout retry, 2 attempts
        RTP->>OAI: POST /v1/chat/completions stream
        RTP->>RTP: StartedStream waits 2 s for the first token
        RTP->>RTP: no token, cancel attempt, ProviderTimeoutException
    end
    RTP-->>PL: ProviderTimeoutException (stage translation)
    PL->>PL: record failure, cancel STT and TTS stages
    PL-->>CT: error provider_timeout (stage translation, provider openai)
    CT->>C: error, turn status failed
    PL-->>CT: turn.end failed
    CT->>C: turn.end, player.end()
    C->>C: after release, playback drains empty, TURN_DONE
    C->>U: turn card shows Timed out at translation and Retry turn
    U->>C: Retry turn
    C->>C: retryTurn: rebuild AudioBuffer from kept frames
    C->>C: runReplayTurn: PRESS, playClip through the capture path, RELEASE
```

The same path covers TTS (2 s first byte), and a stream that stalls for 5 s after its
first item, which is not retried. The STT watchdog fires 2 s after release. It
flushes the last interim and fails with `provider_timeout` (stage `stt`) only when
nothing was committed. In Realtime mode, no `response.created` within 5 s of release
emits `provider_timeout` (stage `response`) and a failed `turn.end`.

Differs from the pre-build spec: the STT final timeout has no retry, because after
release there is no audio left to resend. The 5 s stream-stall timeout and the 5 s
Realtime response timeout are additions.

## 10. Socket drop and reconnect

```mermaid
sequenceDiagram
    participant C as Controller
    participant TM as turnReducer
    participant T as Transport
    participant SRV as Server or OpenAI

    SRV--xT: WebSocket close, or peer connection failed or data channel closed
    T->>T: reconnect(): drop current turn audio (cascade) or teardown (realtime)
    loop attempt n from 1 to 5
        T->>C: connection Reconnecting (n of 5)
        C->>C: sessionError socket_drop, banner Reconnecting attempt n of 5
        C->>TM: ERROR socket_drop (first time only)
        TM-->>C: Error, effect cancelTurn if busy
        C->>C: abortTurn: gate closed, player reset, turn marked cancelled
        T->>T: wait min(4 s, 500 ms x 2 to the n-1)
        alt cascade
            T->>SRV: new WebSocket, session.configure, wait session.ready
        else realtime
            T->>SRV: new client secret, new SDP exchange (diagram 2)
        end
        alt success
            T->>C: connection Connected
            C->>C: clear socket_drop
            C->>TM: RECOVER, Error to Ready
        else failure
            T->>T: close and try again
        end
    end
    opt all 5 attempts failed
        T->>C: connection Failed
        C->>C: banner Connection failed after 5 attempts, reload to retry
    end
    Note over C: MetricsStore is untouched, transcripts are kept
```

Both transports use the same loop: `MAX_RECONNECTS = 5`, backoff 0.5, 1, 2, 4, 4 s.
An explicit `close()` sets `closed` and stops reconnects, so a mode switch never
triggers one. `RECOVER` also applies a queued mode switch. The soak test calls
`forceDrop()` to exercise this path. On the server, a closed socket cancels the
active pipeline in `CascadeSession.RunAsync`.

## Timing marks reference

| mark | captured in (file:function) | clock | appears in diagrams # |
|---|---|---|---|
| press | `client/src/session/controller.ts:startTurn` (via `MetricsStore.startTurn`, called synchronously from the pointerdown handler) | browser `performance.now()` | 3, 4 |
| access | cascade: `client/src/transports/cascade/CascadeTransport.ts:sendFrame` (first frame sent). Realtime: `client/src/transports/realtime/RealtimeTransport.ts:startTurn` (track already live) | browser `performance.now()` | 3, 4 |
| speechStart | `client/src/session/controller.ts:onFrame` (EnergyDetector `speech_start`) | browser, capture frame time (`captureEngine.ts` maps worklet time to `performance.now()` minus input latency) | 3 |
| T0 | `client/src/session/controller.ts:completeRelease` (`setMark t0 = min(detector.lastVoicedEnd, release)`) | browser, capture frame time | 3, 4 |
| release | `client/src/session/controller.ts:releaseTurn` | browser `performance.now()` | 3, 4 |
| stt_final | server `server/src/Workbench.Core/Pipeline/CascadeTurnPipeline.cs:RunSttAsync` (ms since release). Mark set in `client/src/state/metrics.ts:MetricsStore.stage` | server Stopwatch duration, mark = browser receipt time from `CascadeTransport.onMessage` | 4 |
| translate_first_token | server `CascadeTurnPipeline.cs:RunTranslationAsync` (ms from segment start). Mark in `MetricsStore.stage` | server Stopwatch duration, mark = browser receipt time | 4, 5, 8 |
| translate_done | server `CascadeTurnPipeline.cs:RunTranslationAsync`. Mark in `MetricsStore.stage` | server Stopwatch duration, mark = browser receipt time | 4, 8 |
| tts_first_byte | server `CascadeTurnPipeline.cs:RunTtsAsync` (ms from synthesis start). Mark in `MetricsStore.stage` | server Stopwatch duration, mark = browser receipt time | 4 |
| rt_response_start | `client/src/transports/realtime/eventMapper.ts:handle` on `response.created`, with `now` from `RealtimeTransport.ts:onServerEvent` | browser `performance.now()` on data-channel receipt | 3 |
| first_audible | cascade: `client/src/audio/worklets/playback.worklet.ts:process` (OutputTap) mapped by `client/src/audio/player.ts` via `clock.ts:ctxTimeToPerf`. Realtime: `client/src/audio/remoteTap.ts:arm` (AnalyserNode poll) | cascade: AudioContext time mapped to `performance.now()` with `getOutputTimestamp`. Realtime: `performance.now()` in a 5 ms poll | 3, 4 |

Headline metric: mouth-to-ear = `first_audible - T0`. Access time = `access - press`.
Both are computed in `client/src/state/metrics.ts`. Stage marks keep the latest
segment's receipt time. All other marks are first-write-wins, except T0, which
`setMark` overwrites at release.

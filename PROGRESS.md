# PROGRESS

Work top to bottom. Tick items as you finish them. Every milestone ends with:
build, all tests green, a self-review against its acceptance criteria and
CLAUDE.md, an update to this file, and scoped commits.

Status legend: `[ ]` todo · `[x]` done · `[~]` partial · `BLOCKED: reason`

---

## M0 · Scaffold (≈45 min)
- [x] `git init` if needed. Make the first commit with the pack files, and
      include `.gitignore` (already in the pack: `.env`, .NET, Node,
      Playwright, `harness/results/tmp/`) in that same first commit. Confirm
      `.env` is ignored and `.env.example` is tracked before committing.
- [x] Server: `Workbench.sln` with Api, Core, Providers, and Tests (xUnit)
      projects. Add a health endpoint, and config binding for Providers and
      keys.
- [x] Load `.env` via DotNetEnv in Workbench.Api before builder config (real
      environment variables take precedence).
- [x] Add dotenv for Node scripts (harness, report, Playwright setup) that
      need keys.
- [x] Client: Vite + React + TS app. Proxy `/api` and `/ws` to :5080. Copy
      the logo from `docs/design/boostlingo-logo.png` to `client/public/`.
- [x] Root `package.json` scripts: `dev` (backend + client concurrently),
      `test` (dotnet test + vitest), `e2e` (Playwright), `report`. They must
      work on Windows and macOS.
- [x] Event contracts as C# records, plus TS types and a round-trip contract
      test.
- [x] Health endpoint reports which env vars are missing (names only). The
      client shows the `config_error` panel when any are missing.

**Acceptance:**
- `npm run dev` serves the client on :5173, and the client reaches
  `/api/health`.
- `npm test` passes.

**Notes (M0):** verified 2026-10-15: `npm run dev` serves :5173, `/api/health`
through the Vite proxy returns `configOk: true`; `npm test` = 20 xUnit + 17
vitest green. `.env` ignored / `.env.example` tracked checked before the first
commit.

## M1 · Audio engine and floor control (≈1.5 h)
- [x] CaptureWorklet: PCM16 16 kHz mono, 20 ms frames. Input source is the
      mic or a replay WAV, through the same path.
- [x] Energy detector emits speech start and speech end (T0). Tune its
      threshold for the clips.
- [x] PlaybackWorklet with a small jitter buffer, plus an OutputTap that
      emits `first_audible`.
- [x] Turn and floor state machine per `docs/architecture.md` §4, with
      table-driven vitest tests:
      - deny in Capturing, Finalizing, and Playing
      - mode switch queued
      - "Not ready" while Warming
      - Error -> Ready on recovery
- [x] The deny tone bypasses the OutputTap. Add a test that a deny never
      produces `first_audible`.
- [x] Two talk buttons with pointer and keyboard hold. The deny tone is
      generated with Web Audio. Shake animation. Capture muted during
      playback.
- [x] Metrics store records every mark per turn, with run conditions.

**Acceptance:**
- State machine tests are green.
- Replaying a WAV produces press, access, T0, and release marks.

**Notes (M1):** 73 vitest + 3 Playwright (simulated transport) green. Replay of
the fixture: speechStart 151 ms / T0 2352 ms after press vs. the clip's own
voiced span 100-2280 ms (constant ~50 ms press-to-clip offset), so the -45 dBFS
threshold is right for clean speech. A subagent review found 4 must-fix bugs
(press/release race, T0 stamped on the output clock, partial safety-timeout
cleanup, mode switch bypassing session errors); all fixed, plus in-flight
frame flush at release, frame-end interpolation, stale-audio reset, guards on
input/strategy changes mid-turn.

## M2 · Realtime mode end to end (≈2 h)
- [x] Read the current OpenAI Realtime + WebRTC docs. Record the URLs in the
      code.
- [x] `POST /api/realtime/session` mints a short-lived client secret, with
      the interpreter instructions, turn detection off, and input
      transcription on.
- [x] RealtimeTransport: WebRTC, send track from the capture graph, data
      channel. On release: commit and request a response. Map events to the
      normalized schema.
- [x] Remote audio track gets an AnalyserNode -> `first_audible`, and
      `rt_response_start` from the data channel.
- [x] Playwright e2e with fake audio capture of an EN clip: asserts that
      target text appears and that `first_audible` is recorded. Skip with a
      message if the OpenAI key is missing.

**Acceptance:** an EN clip produces Spanish audio and transcripts, with marks
recorded.

**Notes (M2):** `POST /api/realtime/session` verified against the live API
(gpt-realtime). Playwright e2e passes on the real model: EN fixture -> Spanish
target text + audio, all marks recorded. Provider-boundary xUnit tests cover
the minted session config, key never returned, config_error and 429 mapping.

## M3 · Cascade core with fakes (≈2 h)
- [x] The orchestrator: bounded channels, a per-turn CancellationTokenSource,
      and a single writer per socket.
- [x] CommitPolicy `segment` and `clause` as pure classes, with xUnit tests:
      - revisions
      - empty finals
      - run-on speech
      - EN/ES reordering examples
      - no duplicate commits
- [x] Fake providers with configurable latency, 429s, timeouts, and empty
      output.
- [x] Pipeline tests: streaming starts before the end of the turn,
      cancellation, ordering, timeout -> `provider_timeout`, empty ->
      `empty_result`, and 429 -> retry, then failover.
- [x] `/ws/cascade` endpoint plus the CascadeTransport client. Audio is
      buffered until release (consecutive playback).
- [x] Warm-up on connect: the server pre-connects its provider clients.
      Press-to-warm: the STT stream opens on press.

**Acceptance:** all pipeline tests are green, and a cascade turn works end to
end with fakes.

**Notes (M3):** 65 xUnit (16 commit-policy, 14 pipeline, 4 socket, 5 contract,
others) + 3 Playwright over /ws/cascade with server fakes (end to end, 429
failover, translation timeout). Subagent review found 2 must-fix lifecycle
bugs (Cancel on a disposed turn could skip session cleanup; a dead writer
could hang a turn on a full channel) - both fixed - plus clause-policy
alignment after STT revisions, watchdog race, retryable 408/425, stale
playback messages across turns (worklet generation tags), warm-up timer
cleanup.

## M4 · Real cascade providers (≈2 h)
- [x] Read the current docs for Deepgram streaming, ElevenLabs streaming, and
      DeepL. Record the URLs in each adapter.
- [x] Deepgram STT adapter (interim + final; finalize on release).
- [x] OpenAI streaming translation adapter (context = last 2 segments).
- [x] ElevenLabs streaming TTS adapter.
- [x] DeepL translation adapter (secondary and failover).
- [x] Polly retry with jitter, plus a circuit breaker -> DeepL failover,
      recorded on the turn.
- [x] Contract tests per adapter, skipped when the key is missing.

**Acceptance:** an EN clip and an ES clip each work end to end on real
providers in cascade-segment mode.

**Notes (M4):** contract tests pass against all four real APIs. Playwright
on real providers, cascade-segment: en-01 -> "Mi hijo ha tenido fiebre desde
anoche." mouth-to-ear 1918 ms; es-01 -> "I have an appointment at 3 with the
doctor." 1460 ms (single runs, for the acceptance check only; the report
uses p50/p95). Evaluation clips were generated here (M6 items 1-2 pulled
forward) because M4 needs a Spanish clip and no offline Spanish voice exists.

## M5 · Full UI per spec (≈2 h)
- [x] Implement `docs/ui-spec.md` completely:
      - header controls
      - pending switch banner
      - speaker stage
      - pipeline chips
      - transcripts
      - latency waterfall
      - p50/p95 table
      - export button
- [x] Every error state in the spec, wired to the real error events.
- [x] Responsive layout down to phone width.

**Acceptance:** a manual-equivalent Playwright walkthrough passes for both
modes and a mode switch. The error states are reachable by injecting fake
failures.

**Notes (M5):** 11 Playwright specs green: walkthrough (cascade turns,
segment -> clause switch, export JSON), queued mid-turn mode switch then a
live Realtime turn and back, phone width (390 px, no horizontal scroll,
44 px targets), and one test per error state: provider_timeout,
provider_error (HTTP 400), rate_limited toast + failover note, empty_result,
socket_drop (forced drop, banner "attempt 1 of 5", recovery), config_error
(stubbed health), internal (stubbed session mint), mic_denied
(getUserMedia rejects NotAllowedError; headless Chromium ignores the deny
flags). floor_denied is covered by the M1 spec.

## M6 · Evaluation harness (≈2 h)
- [x] `harness/scripts.json`: 12 EN + 12 ES sentences, with reference
      transcripts and translations.
- [x] Generate the WAV clips once with TTS and cache them in
      `harness/clips/`. Commit them if they total under 20 MB.
- [x] Playwright harness: every clip through four configurations. Results go
      to `harness/results/`. Respect the CLAUDE.md cost guardrails.
      - Realtime
      - Cascade-segment
      - Cascade-clause
      - Cascade-segment with DeepL as primary translator (provider
        flexibility evidence, config change only)
- [x] Automated quality rubric: an LLM judge scores accuracy, completeness,
      and fluency 1-5 per turn. Label it "automated judge".
- [x] `npm run report`:
      - p50/p95 per stage, mode, and strategy
      - access time
      - source WER (cascade)
      - target WER vs. reference translation (labelled as a proxy)
      - rubric scores
      - "answered instead of interpreted" rate
      - cost per minute from `harness/pricing.json`
      - output to `harness/results/report.md`
- [x] Soak test: 5 minutes per mode. Record disconnects, playback buffer
      depth, heap at start vs. end, and recovery time after one forced
      transport drop.
- [x] Language-pair onboarding exercise (after everything above passes): add
      English <-> French via config plus 2 clips per direction. Record the
      files touched and the effort for each architecture in
      `harness/results/onboarding.md`.

**Acceptance:** `report.md` exists with real numbers for all four
configurations, plus the soak, provider-swap, and onboarding results.

**Notes (M6):** run 1 of each configuration (24/24 turns completed in all
four): mouth-to-ear p50/p95 Realtime 0.89/1.06 s, cascade-segment
1.41/1.65 s, cascade-clause 1.20/1.46 s, cascade-DeepL 1.15/1.22 s. Cost
per speech-minute Realtime $0.205, cascade $0.043 (DeepL $0.066, DeepL rate
unverified). Judge 4.7-5.0 across the board; 0/24 answered-instead-of-
interpreted in every configuration. Soak 5 min per mode: 45 turns each, 0
failures, 0 unplanned disconnects, forced-drop recovery 2.1 s (Realtime) /
1.1 s (cascade), transcripts intact. EN<->FR onboarded by config in ~2 min.
Harness runs used: Realtime 3 of 3, each cascade configuration 2 of 3 (the
first DeepL attempt aborted mid-run on a page reload and saved nothing; see
Decisions). Soak runs used: 1 of 1 per mode. The run-1 numbers above were
superseded by the pooled report in M7 (Realtime p50/p95 1.09/1.46 s over 72
turns; segment 1.43/1.89, clause 1.21/1.44, DeepL 1.15/1.25 over 48).

## M7 · Review, docs, and morning handoff (≈1.5 h)
- [x] Architecture review pass (use a subagent if available): check every
      CLAUDE.md must-have, locked decision, and code quality expectation
      against the code. Fix any gaps, and list what is not fixable.
- [x] Run the full suite: `npm test` and `npm run e2e`. Everything is green
      or explicitly skipped with a reason.
- [x] `README.md`:
      - setup on Windows and macOS (prerequisites; copy `.env.example` to
        `.env` and add keys)
      - run
      - architecture overview with a diagram
      - why C#/.NET
      - how to swap a provider
      - known limitations
- [x] `docs/requirements.md`: a traceability matrix. Columns: every
      requirement in `docs/brief.md` (functional, performance, code quality,
      other) -> where it is implemented -> the test that proves it -> the
      evidence (test name, report section, or screenshot) -> status.
- [x] `docs/comparison.md` (1-2 pages), from report.md numbers only,
      following "Comparison write-up requirements" in CLAUDE.md, including
      every disclosure listed there.
- [x] Append the agent log to the "How I directed the agent" section of
      CLAUDE.md.
- [x] `MORNING.md` for the user:
      - the URL
      - one command to start, in case the app has stopped
      - a 5-minute guided test script (what to click, what to expect)
      - the headline results table
      - a 10-turn human scoring sheet (accuracy, completeness, fluency 1-5)
        to spot-check the automated judge
      - what is BLOCKED or partial
      - suggested next steps
- [x] Final commit.
- [x] Final step: start `npm run dev` as a background task, confirm that
      `/api/health` is OK and that http://localhost:5173 loads, and **leave
      it running**.

**Notes (M7):** a subagent architecture review found 13 gaps; fixed: Realtime
warm-up hang in real Chrome (audio resumed from the press), Deepgram connect
retry, stalled-stream and Realtime response timeouts, per-mode config gate
(missing DeepL no longer blocks), commit policy via DI + config, provider
factory tests, deny tone kept out of T0, report pooling + server stage
durations, doc claims. Kept as disclosed limitations: output-latency
asymmetry, TTS per segment (not mid-segment), STT final without retry.
A second harness run per configuration (and a third for Realtime) showed
Realtime's vendor-side variance; the comparison reflects it. Final suite:
`npm test` 73 xUnit + 85 vitest green, `npm run e2e` 19/19 green.

---

## Decisions made during the run
(The agent appends here.)

- **M0 · .NET SDK:** no .NET SDK was installed on the machine. Installed the
  .NET 10 LTS SDK (10.0.402) into the gitignored repo-local `.dotnet/` with
  Microsoft's signed `dotnet-install.ps1` (no global install).
  `scripts/dotnet.mjs` prefers `.dotnet/`, then `dotnet` on PATH, so the npm
  scripts work on any machine with a normal SDK install too.
- **M0 · Event wire format:** `audio.chunk` carries base64 PCM16 in JSON
  (simple, contract-testable; ~33% overhead is irrelevant on localhost).
  Added two events beyond the table in architecture §3: `segment.commit`
  (drives the Commit chip and shows what the policy released) and
  `provider.failover` (the failover note on the turn).
- **M0 · Contract test:** `contracts/event-samples.json` is round-tripped by
  both xUnit (`EventContractTests`) and vitest (`events.test.ts`); both sides
  also assert every declared event type has a sample.
- **M0 · Config:** languages and pairs live in `appsettings.json`
  (`Languages`), served by `GET /api/config`; clips are served by
  `GET /api/clips` from `harness/clips/`. Node scripts load `.env` via
  `scripts/env.mjs` (dotenv, override false).
- **M1 · Replay automation:** a replay turn presses, plays the clip through
  the capture graph, and releases 250 ms after the clip ends. T0 comes from
  the energy detector, so the tail does not enter the headline metric, but
  any trailing silence in a clip delays release (and therefore finalization)
  just like a slow human release would. Eval clips are trimmed (M6).
- **M1 · Clocks:** capture marks use the capture context's processing time
  (minus the mic's reported input latency); first_audible uses
  getOutputTimestamp (when the sample reaches the speaker) in cascade, and a
  5 ms-polled AnalyserNode on the remote track in Realtime. The cascade mark
  therefore includes the device's output latency and the Realtime mark does
  not (it sees samples just before output): a small bias in Realtime's
  favour, disclosed in comparison.md rather than corrected with an estimate.
- **M1 · Client-only FakeTransport** (`?transport=fake`) for UI/audio work
  with no backend audio path; server-side fakes come in M3.
- **M1 · Retry turn:** the controller keeps the last 5 turns' captured PCM;
  "Retry turn" replays it through the same capture path (works in both modes,
  mic or replay input).
- **M2 · Direction per turn:** one Realtime session serves both speakers. On
  press the client sends `session.update` (instructions + transcription
  language for that direction) and `input_audio_buffer.clear`; on release
  `input_audio_buffer.commit` + `response.create` with the same instructions.
  The server owns the prompt text (returned by `/api/realtime/session`).
- **M2 · Context:** conversation items older than the last 2 turns are
  deleted (`conversation.item.delete`), matching the cascade's 2-segment
  context and bounding cost over a long session.
- **M2 · Access time (Realtime):** the WebRTC track is always live, so
  access = press + the time to send `session.update`/`clear` (near zero).
  Cascade access is the first frame sent on the WebSocket.
- **M2 · Model:** locked `gpt-realtime` (snapshot gpt-realtime-2025-08-28,
  still GA). Newer `gpt-realtime-2.x` and `gpt-realtime-translate` exist;
  noted for the write-up, not used (locked decision).
- **M3 · Fallback naming:** a fake primary fails over to a distinct fake
  (`fake-deepl`) so the 429 -> failover path is demonstrable without keys
  (`?providers=fake&faults=translation:429`). Faults apply to fakes only.
- **M3 · Circuit breaker:** custom `FailoverCircuit` (open for 60 s once the
  Polly retry budget for 429s is exhausted), shared per real provider across
  sessions; Polly does the retries with exponential backoff + jitter. Polly's
  own breaker needs >= 2 samples and a sampling window, which does not match
  "open after 429 three times" cleanly.
- **M3 · STT final timeout:** no retry (after release there is no audio to
  resend). On timeout the policy flushes what was heard; if nothing was
  heard, `provider_timeout` at stt. Deviation from §6 "one retry".
- **M3 · Clause policy:** stable = unchanged across two consecutive
  partials; boundary = clause punctuation or before a conjunction, min 3
  words unless . ? !. Words already committed are not re-sent if STT later
  revises them; the final is aligned on the last committed word.
- **M4 · Translation model:** `gpt-4.1-nano`. Measured 2026-10-15
  (3 streamed calls each, warm): gpt-4.1-nano TTFT ~360-400 ms,
  gpt-4o-mini ~420-870 ms, gpt-4.1-mini ~860 ms, gpt-6-luna ~960-1060 ms;
  same translation for the test sentence. Config: `OpenAI:TranslationModel`.
- **M4 · Deepgram end of turn:** Deepgram works through audio at ~real-time
  pace even when it arrives in a burst, and the Finalize response only
  covers what it has processed so far (measured). The adapter ends the turn
  when a final's end time reaches the audio sent, with an inactivity
  timeout after Finalize. With real-time pacing the final arrived 66 ms
  after Finalize.
- **M4 · TTS:** ElevenLabs HTTP streaming (`/stream`, pcm_24000,
  eleven_flash_v2_5, voice Matilda) - the docs recommend HTTP over the
  WebSocket when the full text is known, which is the case per segment.
  Odd bytes split across network reads are carried to the next chunk.
- **M4 · Clips:** synthetic speakers are ElevenLabs multilingual_v2 voices
  (EN George, ES Sarah), distinct from the cascade output voice. Clips are
  trimmed to 250 ms lead-in / 150 ms tail.
- **M5 · Failover toast copy:** the server retries 429s 3 times (4 attempts)
  before failing over, so the toast shows the server's reason ("429 4 times;
  circuit open for 60 s. Switched to DeepL.") instead of the mock's fixed
  "three times".
- **M5 · Waterfall:** cascade stage marks are browser receipt times of the
  final segment's stage.timing events; a stage that finished before T0
  (consecutive playback pre-synthesized it during speech) shows "during
  speech". Realtime internals show "hidden", never estimated.
- **M6 · Harness input:** clips go through the app's Replay input (same
  capture graph as the mic, press/release automated) rather than Chromium's
  fake-audio-capture file, which loops from browser start and cannot be
  aligned with a button press. Release lands ~410 ms after T0 (150 ms clip
  tail + 250 ms), the same for every configuration.
- **M6 · Page reload during a run:** the first DeepL run aborted at clip
  es-06 because the page reloaded (most likely the Vite watcher reacting to
  files I edited elsewhere in the repo). Fixed by restricting Vite's watcher
  to the client and making the runner retry a clip once after a reload
  (counted in `pageReloads`). The aborted attempt saved nothing.
- **M6 · Heap metric:** the soak samples usedJSHeapSize without forcing GC,
  so it saw-tooths; the report shows the post-GC floor in the first vs. the
  last minute (both modes +4-5 MB over 45 turns, consistent with retained
  transcripts) alongside the raw start/end values.
- **M6 · Judge:** gpt-4.1-mini, temperature 0, JSON output, cached in
  `harness/results/judge-cache.json` so regenerating the report is free.
- **M7 · Report pools runs:** p50/p95 are over every saved run of a
  configuration, with a per-run table so variance stays visible. Realtime
  got its third run because runs 1 and 2 disagreed (p95 1.06 vs 1.72 s).
- **M7 · Output latency not corrected:** Realtime's first-audible could be
  shifted by an estimated `outputLatency`, but that would be an estimate in
  a "measured only" report; the asymmetry is disclosed instead.
- **Follow-up · Translation controls:** formal register + clinic glossary,
  on by default (`TranslationControls` in appsettings.json, `?controls=off`
  per session). DeepL: `formality: prefer_more` + one v3 multilingual
  glossary (the Free plan allows a single glossary; matching is literal, so
  noun phrases like "la receta" need their own entries — both verified
  live). OpenAI translator and Realtime: the same instructions in the prompt.
  Baseline harness configs now pin `controls=off`; the experiment's runs
  and before/after report are in `harness/results-controls/`.
- **Follow-up · Clinic terms toggle (D-23 change):** header toggle
  (Clinic terms | Off, both modes, re-warms between turns) and a per-turn
  "Clinic terms on/off" tag, saved in run conditions and exports. Default
  from `/api/config` (`translationControls.enabled`). No glossary editing
  or term highlighting in the UI (still out of scope).
- **M7 · Optional DeepL key:** DeepL is the failover; without its key the
  cascade runs with no failover instead of refusing to start, and Realtime
  needs only the OpenAI key (`/api/health` reports `missingByMode`).

## Blockers
(The agent appends here.)

## Session log
(The agent appends one line per session: start time, milestones covered, and
where it stopped.)

- 2026-10-14 23:57 → 2026-10-15 02:16 local (corrected from "~07:30", which was UTC):
  M0-M7 in one session; stopped after M7 with `npm run dev` running.
- 2026-10-15 daytime, follow-ups at the user's request: translation controls
  (+ `harness/results-controls/`, docs/translation-controls.md), the user's
  planning docs committed (00-planning-session, decisions, measurement-protocol),
  Clinic terms toggle + card tag. Stopped with a clean tree at `7e168f9`+.
  **Resume notes:** nothing pushed yet (pushing is the user's to do:
  `git push -u origin main`). Harness budget used: realtime 3/3, cascade
  baselines 2/3 each, each `*-controls` config 1/3, soaks 1/1 per mode.
  Open idea: test the glossary on held-out sentences (MORNING.md next steps).

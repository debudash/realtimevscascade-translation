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
- [ ] CaptureWorklet: PCM16 16 kHz mono, 20 ms frames. Input source is the
      mic or a replay WAV, through the same path.
- [ ] Energy detector emits speech start and speech end (T0). Tune its
      threshold for the clips.
- [ ] PlaybackWorklet with a small jitter buffer, plus an OutputTap that
      emits `first_audible`.
- [ ] Turn and floor state machine per `docs/architecture.md` §4, with
      table-driven vitest tests:
      - deny in Capturing, Finalizing, and Playing
      - mode switch queued
      - "Not ready" while Warming
      - Error -> Ready on recovery
- [ ] The deny tone bypasses the OutputTap. Add a test that a deny never
      produces `first_audible`.
- [ ] Two talk buttons with pointer and keyboard hold. The deny tone is
      generated with Web Audio. Shake animation. Capture muted during
      playback.
- [ ] Metrics store records every mark per turn, with run conditions.

**Acceptance:**
- State machine tests are green.
- Replaying a WAV produces press, access, T0, and release marks.

## M2 · Realtime mode end to end (≈2 h)
- [ ] Read the current OpenAI Realtime + WebRTC docs. Record the URLs in the
      code.
- [ ] `POST /api/realtime/session` mints a short-lived client secret, with
      the interpreter instructions, turn detection off, and input
      transcription on.
- [ ] RealtimeTransport: WebRTC, send track from the capture graph, data
      channel. On release: commit and request a response. Map events to the
      normalized schema.
- [ ] Remote audio track gets an AnalyserNode -> `first_audible`, and
      `rt_response_start` from the data channel.
- [ ] Playwright e2e with fake audio capture of an EN clip: asserts that
      target text appears and that `first_audible` is recorded. Skip with a
      message if the OpenAI key is missing.

**Acceptance:** an EN clip produces Spanish audio and transcripts, with marks
recorded.

## M3 · Cascade core with fakes (≈2 h)
- [ ] The orchestrator: bounded channels, a per-turn CancellationTokenSource,
      and a single writer per socket.
- [ ] CommitPolicy `segment` and `clause` as pure classes, with xUnit tests:
      - revisions
      - empty finals
      - run-on speech
      - EN/ES reordering examples
      - no duplicate commits
- [ ] Fake providers with configurable latency, 429s, timeouts, and empty
      output.
- [ ] Pipeline tests: streaming starts before the end of the turn,
      cancellation, ordering, timeout -> `provider_timeout`, empty ->
      `empty_result`, and 429 -> retry, then failover.
- [ ] `/ws/cascade` endpoint plus the CascadeTransport client. Audio is
      buffered until release (consecutive playback).
- [ ] Warm-up on connect: the server pre-connects its provider clients.
      Press-to-warm: the STT stream opens on press.

**Acceptance:** all pipeline tests are green, and a cascade turn works end to
end with fakes.

## M4 · Real cascade providers (≈2 h)
- [ ] Read the current docs for Deepgram streaming, ElevenLabs streaming, and
      DeepL. Record the URLs in each adapter.
- [ ] Deepgram STT adapter (interim + final; finalize on release).
- [ ] OpenAI streaming translation adapter (context = last 2 segments).
- [ ] ElevenLabs streaming TTS adapter.
- [ ] DeepL translation adapter (secondary and failover).
- [ ] Polly retry with jitter, plus a circuit breaker -> DeepL failover,
      recorded on the turn.
- [ ] Contract tests per adapter, skipped when the key is missing.

**Acceptance:** an EN clip and an ES clip each work end to end on real
providers in cascade-segment mode.

## M5 · Full UI per spec (≈2 h)
- [ ] Implement `docs/ui-spec.md` completely:
      - header controls
      - pending switch banner
      - speaker stage
      - pipeline chips
      - transcripts
      - latency waterfall
      - p50/p95 table
      - export button
- [ ] Every error state in the spec, wired to the real error events.
- [ ] Responsive layout down to phone width.

**Acceptance:** a manual-equivalent Playwright walkthrough passes for both
modes and a mode switch. The error states are reachable by injecting fake
failures.

## M6 · Evaluation harness (≈2 h)
- [ ] `harness/scripts.json`: 12 EN + 12 ES sentences, with reference
      transcripts and translations.
- [ ] Generate the WAV clips once with TTS and cache them in
      `harness/clips/`. Commit them if they total under 20 MB.
- [ ] Playwright harness: every clip through four configurations. Results go
      to `harness/results/`. Respect the CLAUDE.md cost guardrails.
      - Realtime
      - Cascade-segment
      - Cascade-clause
      - Cascade-segment with DeepL as primary translator (provider
        flexibility evidence, config change only)
- [ ] Automated quality rubric: an LLM judge scores accuracy, completeness,
      and fluency 1-5 per turn. Label it "automated judge".
- [ ] `npm run report`:
      - p50/p95 per stage, mode, and strategy
      - access time
      - source WER (cascade)
      - target WER vs. reference translation (labelled as a proxy)
      - rubric scores
      - "answered instead of interpreted" rate
      - cost per minute from `harness/pricing.json`
      - output to `harness/results/report.md`
- [ ] Soak test: 5 minutes per mode. Record disconnects, playback buffer
      depth, heap at start vs. end, and recovery time after one forced
      transport drop.
- [ ] Language-pair onboarding exercise (after everything above passes): add
      English <-> French via config plus 2 clips per direction. Record the
      files touched and the effort for each architecture in
      `harness/results/onboarding.md`.

**Acceptance:** `report.md` exists with real numbers for all four
configurations, plus the soak, provider-swap, and onboarding results.

## M7 · Review, docs, and morning handoff (≈1.5 h)
- [ ] Architecture review pass (use a subagent if available): check every
      CLAUDE.md must-have, locked decision, and code quality expectation
      against the code. Fix any gaps, and list what is not fixable.
- [ ] Run the full suite: `npm test` and `npm run e2e`. Everything is green
      or explicitly skipped with a reason.
- [ ] `README.md`:
      - setup on Windows and macOS (prerequisites; copy `.env.example` to
        `.env` and add keys)
      - run
      - architecture overview with a diagram
      - why C#/.NET
      - how to swap a provider
      - known limitations
- [ ] `docs/requirements.md`: a traceability matrix. Columns: every
      requirement in `docs/brief.md` (functional, performance, code quality,
      other) -> where it is implemented -> the test that proves it -> the
      evidence (test name, report section, or screenshot) -> status.
- [ ] `docs/comparison.md` (1-2 pages), from report.md numbers only,
      following "Comparison write-up requirements" in CLAUDE.md, including
      every disclosure listed there.
- [ ] Append the agent log to the "How I directed the agent" section of
      CLAUDE.md.
- [ ] `MORNING.md` for the user:
      - the URL
      - one command to start, in case the app has stopped
      - a 5-minute guided test script (what to click, what to expect)
      - the headline results table
      - a 10-turn human scoring sheet (accuracy, completeness, fluency 1-5)
        to spot-check the automated judge
      - what is BLOCKED or partial
      - suggested next steps
- [ ] Final commit.
- [ ] Final step: start `npm run dev` as a background task, confirm that
      `/api/health` is OK and that http://localhost:5173 loads, and **leave
      it running**.

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

## Blockers
(The agent appends here.)

## Session log
(The agent appends one line per session: start time, milestones covered, and
where it stopped.)

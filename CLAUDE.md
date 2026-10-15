# Boostlingo AI Interpreter Workbench

You are building, unattended, a browser workbench that compares two live
interpretation architectures:

- **Realtime:** OpenAI Realtime API, model `gpt-realtime`, voice in / voice out.
- **Cascade:** a streaming STT -> Translation -> TTS pipeline that we compose
  ourselves.

The point is a measured, defensible recommendation for which architecture fits
which scenario. Build both, instrument both identically, and measure them.

Read these first:
- `docs/brief.md`: the brief. It governs. `docs/prd-summary.md` is a summary;
  where they conflict, follow the brief.
- `docs/architecture.md`: the target architecture and contracts.
- `docs/ui-spec.md`: the screen, controls, and states.
- `docs/design/`: the design reference (see the README there).
- `PROGRESS.md`: the milestone checklist. This is your work queue and your
  memory between sessions.

## Must-haves (from the brief; all are required)

1. Browser SPA with microphone capture and audio playback.
2. Realtime mode using gpt-realtime, voice in / voice out.
3. Cascade mode: STT -> Translation -> TTS, streaming throughout, with no
   full-utterance blocking.
4. A UI toggle to switch modes, pre-session or mid-session. A mid-session
   switch is queued until the current turn ends.
5. Language pair selection, minimum English <-> Spanish.
6. Live source and target transcripts, shown as they are produced.
7. Per-stage latency visible in the UI.
8. `docs/comparison.md`, 1-2 pages: latency, quality, cost, controllability,
   and a recommendation for which mode fits which scenario. It also covers
   the brief's other impact metrics: provider flexibility, and time to onboard
   a new language pair. See "Comparison write-up requirements" below.

### Performance targets
- Realtime: under 1.5s, speech end -> first audible interpreted audio.
- Cascade: under 3s, stretch goal under 2s.
- A 5-minute back-and-forth with no disconnects, audio drift, or memory leaks.

### Code quality expectations
- Mode-specific transport is cleanly separated from the mode-agnostic UI.
- Provider interfaces, so swapping a provider is a contained change.
- Targeted tests on the cascade pipeline and provider boundaries.
- Handling for rate limits, timeouts, empty results, and mic permission denied.
- README with setup, run, and architecture.
- Scoped git commits with meaningful messages.

## Locked decisions (do not change; if one blocks you, log it in PROGRESS.md)

### Stack
- Backend: C# on ASP.NET Core, current .NET LTS. One process, with a control
  module (sessions, turns) and a media module (cascade pipeline).
- Frontend: TypeScript, Vite, React.
- Local only. Backend on http://localhost:5080. Vite on http://localhost:5173,
  proxying `/api` and `/ws` to the backend.
- Root `package.json` scripts, which must work on Windows and macOS:
  - `npm run dev`: backend + client together
  - `npm test`: all unit and integration tests
  - `npm run e2e`: Playwright tests
  - `npm run report`: evaluation report

### Transports
- **Realtime:** the browser connects directly to OpenAI over WebRTC, using a
  short-lived client secret minted by `POST /api/realtime/session`. The OpenAI
  key never reaches the browser.
- **Cascade:** the browser streams PCM16 16 kHz mono frames over WebSocket
  `/ws/cascade`. The server streams normalized events and audio back.
- One TypeScript `InterpreterTransport` interface, with two implementations.
  The UI consumes only normalized events.

### Providers
- Defaults: Deepgram streaming STT, OpenAI LLM translation (streamed),
  ElevenLabs streaming TTS.
- Second translation adapter: DeepL. It is also the failover target on
  repeated 429s.
- C# interfaces (`ISttProvider`, `ITranslationProvider`, `ITtsProvider`,
  `ICommitPolicy`), registered through DI and selected by config.

### Turn model
- Two push-to-talk buttons, one per speaker. Each button is bound to a
  language (English speaker EN->ES, Hablante de espanol ES->EN).
- Consecutive playback: translation and TTS run while the speaker is still
  talking. Interpreted audio starts playing on button release.
- Floor deny: a press while a turn is listening, finalizing, or playing is
  denied. Deny feedback is a short generated two-note tone (Web Audio
  oscillator, ~230 ms, low gain), a button shake, and a "Floor busy" label.
  No queuing. No talk-permit tone. A successful press is shown visually only
  (the button lights).
- The deny tone is never routed through the playback tap. It must never
  register as `first_audible`, which counts interpreted audio only.
- **Warm-up:** on page load and after a mode switch, open the WebRTC or
  WebSocket connection and the provider connections before showing Ready.
  The talk buttons show "Not ready" until then.
- **Press-to-warm:** on press, open the STT stream immediately; on release,
  finalize. This keeps cold starts out of the first turn and out of p95.

### Cascade commit policy
A pure function, selectable at runtime:
- `segment` (default): commit each STT-finalized segment during speech.
- `clause`: commit on clause boundaries within stable partials.

### Measurement
- T0 is acoustic speech end: the last voiced frame from a client-side energy
  detector. It is not button release.
- Release is recorded as a separate mark.
- First audible output is detected at the playback tap in cascade mode, and
  from an AnalyserNode on the remote WebRTC track in Realtime mode.
- Perceived latency is measured on the browser clock (`performance.now()`).
  The server reports stage durations only, measured with Stopwatch.
- Report p50 and p95, never single runs.
- Realtime internal stages are not observable. Show them as "hidden", and
  never estimate them.

### Resilience
- Per-stage timeouts.
- Polly-based retry with jitter on 429s and transient errors.
- A circuit breaker that fails over to the secondary provider.
- A typed error taxonomy:
  - `mic_denied`
  - `socket_drop`
  - `provider_timeout`
  - `rate_limited`
  - `empty_result`
  - `config_error`
  - `provider_error`
  - `internal`

## Secrets

API keys live in `.env` in the repo root. It is gitignored. The user creates
it from `.env.example` before kickoff. The key names are:

- `OpenAI__ApiKey`
- `Deepgram__ApiKey`
- `ElevenLabs__ApiKey`
- `DeepL__ApiKey`

How they are loaded:
- **Backend:** `Workbench.Api` loads `.env` at startup with the `DotNetEnv`
  package, before configuration is built. Real environment variables take
  precedence over `.env` (load without overwriting existing variables).
  ASP.NET Core then binds the double-underscore names as usual.
- **Node scripts** (harness, report, Playwright setup) that need keys load
  `.env` with the `dotenv` package.

Rules:
- You must never open, read, print, edit, or commit `.env`. The running app
  reads it; you do not need to see it.
- Never print, log, echo, or commit a key value, and never write keys into
  any file.
- If a key is missing, the backend starts anyway, and the UI shows the
  `config_error` panel naming the missing variable and pointing to `.env`.
  Tests that need that key are skipped with a clear message.

## How to work overnight (autonomous protocol)

1. **Use PROGRESS.md as your queue.**
   - Work milestones in order. Within a milestone, do the tasks in order.
   - Do not stop to ask the user questions. They are asleep.
   - Make the most reasonable choice consistent with this file, and record
     it under Decisions in PROGRESS.md.
2. **Finish each milestone the same way.**
   - Build: `dotnet build` and the client build.
   - Run the full test suite.
   - Fix failures.
   - Do a self-review against the milestone's acceptance criteria and this
     file. Use a subagent reviewer if available.
   - Fix what the review finds.
   - Update PROGRESS.md: tick the items, write notes, record any blockers.
   - Commit, with one or more scoped commits per milestone. Use conventional
     messages, e.g. `feat(cascade): add segment commit policy`.
3. **If you are blocked on one item** (missing key, unclear API, flaky
   external service):
   - Implement against a fake provider so the rest still works.
   - Mark the item `BLOCKED: <reason>` in PROGRESS.md.
   - Continue to the next item.
   - Never spin on the same failure more than 3 attempts.
4. **Verify provider APIs; never guess.**
   - Before writing any provider adapter, read that provider's current
     official docs with web fetch or search: OpenAI Realtime and WebRTC,
     Deepgram streaming, ElevenLabs streaming, DeepL.
   - Record the doc URLs in a comment at the top of the adapter.
5. **Cost guardrails** (these are paid APIs):
   - Debug with fake providers, not real ones.
   - Generate the synthetic evaluation clips once and cache them in
     `harness/clips/`.
   - At most 3 full harness runs per mode/strategy combination.
   - At most one 5-minute soak run per mode.
6. **Stay safe.**
   - Work only inside this repository.
   - Never `git push`. Never force-anything.
   - Never delete files outside the repo.
   - Never install global tools, except `npx playwright install chromium`.
7. **Context hygiene.** Keep PROGRESS.md current enough that a fresh session
   can resume from it alone. If context gets long, compact and continue.
8. **The final milestone (M7) must leave the app running for the morning.**
   Start `npm run dev` as a background task, confirm it is healthy, and leave
   it running. MORNING.md must still give the one command to start it, in
   case it has stopped.

## Comparison write-up requirements (docs/comparison.md)

**Use measured numbers only,** from `harness/results/report.md`. Never use
estimates. Organize by dimension, each covering Realtime vs. Cascade:

1. **Latency:** mouth-to-ear p50/p95 vs. targets, the stage breakdown, and
   access time.
2. **Quality:** subjective + WER, as the brief asks.
   - Cascade source WER.
   - Target WER vs. reference translation, labelled a crude proxy.
   - Automated rubric scores (accuracy, completeness, fluency).
   - The "answered instead of interpreted" rate.
3. **Cost per minute:** from logged usage times verified prices, with the
   price date.
4. **Controllability:** frame it as control plane vs. media plane.
   - Realtime is vertically integrated: the vendor owns both planes, and its
     internal stages are not observable.
   - Cascade lets us own the media plane: every stage can be measured,
     swapped, and tuned (commit policy, glossary, provider choice).
5. **Provider flexibility:** evidence from swapping cascade translation from
   OpenAI to DeepL (M6), and what changed.
6. **Time to onboard a language pair:** evidence from the M6 onboarding
   exercise. List the files touched and the effort for each architecture.
7. **Recommendation by scenario,** e.g. low-stakes conversational vs.
   regulated, terminology-heavy, or uncommon-pair settings.
8. **Stability:** the 5-minute soak results per mode.

**Disclosures (state these plainly):**
- Clips are synthetic speech.
- Realtime goes browser-direct while the cascade adds a backend hop.
- Consecutive playback lets the cascade pre-synthesize audio during speech,
  while Realtime starts generating only after the commit. That difference
  favors the cascade on the headline metric.
- Realtime's source transcript comes from a side transcription process
  (verify in the docs), so its WER does not measure what the model
  understood.

Close with a short "path to production" paragraph: at scale, the control and
media modules split into separate services.

## How I directed the agent (keep this section; the brief requires it)

- The user prepared this pack (brief, locked decisions, architecture, UI
  design, milestone plan) in a planning session with Claude, then started one
  unattended Claude Code run using KICKOFF.md.
- **Agent:** append one line per milestone, saying what was built, which
  decisions you made, and what you deferred.
- **M0 (agent):** scaffolded .NET 10 solution (Api/Core/Providers/Tests), Vite
  React client, root scripts, .env loading (DotNetEnv / dotenv), health +
  config_error panel, event contract round-tripped by both sides. Decided:
  repo-local .NET SDK (none installed), base64 audio in JSON events.
- **M1 (agent):** audio engine (capture/playback worklets, energy-detector
  T0, OutputTap, deny tone), floor state machine, metrics store, talk
  buttons, simulated transport. A subagent review caught a press/release
  race and a T0 clock bias; both fixed. Deferred: full UI (M5).
- **M2 (agent):** Realtime mode end to end (client-secret mint, WebRTC,
  data-channel event mapper, remote-track first_audible, reconnect 1-5),
  verified on the live API by Playwright. Decided: per-turn session.update
  for direction, prune context to last 2 turns.
- **M3 (agent):** cascade core: segment/clause commit policies, pipeline
  with bounded channels and per-turn cancellation, fakes with fault
  injection, Polly retry + DeepL failover breaker, /ws/cascade with a single
  writer, WebSocket client transport. A subagent review caught two session
  lifecycle hangs; fixed. Deferred: nothing.
- **M4 (agent):** real adapters (Deepgram, OpenAI streamed translation,
  DeepL, ElevenLabs) with doc URLs, contract tests, live e2e in both
  directions. Decided: gpt-4.1-nano from measured TTFT; Deepgram end-of-turn
  by audio coverage (measured behaviour). Pulled clip generation forward.
- **M5 (agent):** full UI per spec: header controls, pending-switch banner,
  speaker stage, chips, transcripts with turn numbers and retry, latency
  waterfall, p50/p95 table, export, every error state, responsive layout;
  Playwright walkthrough + one spec per error state. Decided: fault
  injection via URL for fakes; mic denial simulated at getUserMedia.
- **M6 (agent):** evaluation harness: 24 synthetic clips through four
  configurations on live providers, automated judge, WER, answer heuristic,
  cost per minute, 5-minute soak per mode with a forced drop, EN<->FR
  onboarding by config. Decided: replay input instead of fake-capture file;
  heap floors instead of raw start/end. Deferred: longer soaks.
- **M7 (agent):** subagent architecture review (13 gaps, fixed or disclosed),
  pooled report with run-to-run variance, comparison.md, requirements
  traceability, README, MORNING.md. Decided: disclose rather than estimate
  the output-latency asymmetry; spend the remaining Realtime harness run to
  settle its variance. Left `npm run dev` running.

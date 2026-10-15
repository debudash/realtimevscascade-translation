# Decisions

This log records every design decision made in the planning session, before
the build. Each entry gives its brief basis, the alternatives considered, and
the consequences.

- **Status** is filled in from the code: Implemented, Changed, or Not
  implemented.
- **Evidence** links to the file or test that shows it.
- Decisions made or changed during the build are recorded under "Changes
  during the build" at the end.

Brief = `docs/brief.md` (governs). PRD = `docs/prd-summary.md`.

---

### D-01 · The detailed brief governs over the PRD summary
- **Decision:** where the two documents conflict, follow the detailed brief.
- **Conflicts found:**
  - The PRD lists ".NET, C#, TypeScript, Python" as required languages; the
    brief says "candidate's choice," with .NET/C# + TypeScript preferred and
    Python acceptable.
  - The PRD lists AWS; the brief says cloud is optional and local-only is
    fine.
- **Basis:** the PRD names the brief as its attachment.
- **Alternatives:** treat the PRD as authoritative (it would force all four
  languages and AWS).
- **Consequences:** C#/.NET + TypeScript and local-only are compliant. The
  README explains the language choice, as the brief asks.
- **Status:** Implemented
- **Evidence:** `README.md` "Why C# / .NET" (language rationale) and "Run" (local only). The PRD conflicts are recorded in this entry; no other doc recorded them before this update.

### D-02 · Stack: C# / ASP.NET Core backend, TypeScript + Vite + React frontend
- **Basis:** "Preferred: .NET / C# (backend), TypeScript (frontend)...
  Candidate should explain their choice."
- **Alternatives:**
  - Python / FastAPI: acceptable, and was fully designed first.
  - TypeScript end to end: fastest, with shared types.
  - Go or Rust.
- **Why C#:** it matches the brief's stated preference. Channels,
  `IAsyncEnumerable`, and `CancellationToken` map one-to-one onto the
  streaming pipeline. SDK gaps are solved with raw WebSocket/HTTP adapters.
- **Consequences:** the event contracts need TS type generation or a
  round-trip contract test. Some providers need raw adapters.
- **Status:** Implemented
- **Evidence:** `server/Workbench.sln` (.NET 10), `client/` (Vite + React + TS). The contract is kept by a round-trip test instead of type generation: xUnit `EventContractTests.Sample_round_trips_without_loss` and vitest `client/src/contracts/events.test.ts` "event contract", both over `contracts/event-samples.json`.

### D-03 · Local install only
- **Basis:** "Local-only with clear setup instructions is fine."
- **Alternatives:** AWS (S3 + CloudFront for the SPA, ECS Fargate behind an
  ALB for the backend).
- **Consequences:** no deployment work. `getUserMedia` works on localhost
  without HTTPS. Demo on one machine only.
- **Status:** Implemented
- **Evidence:** `package.json` `dev` script; README "Setup" and "Run" (backend :5080, Vite :5173).

### D-04 · One backend process with a control module and a media module
- **Basis:** "Clean separation between mode-specific transport and
  mode-agnostic UI." Plus the 15-20 h budget and the 5-minute stability
  target.
- **Alternatives:** a telecom-style split into a separate call-processing
  (control) server and a media server, with state machines between them.
- **Why rejected:**
  - There is a single endpoint, with both speakers in one browser.
  - In Realtime mode OpenAI is the media plane, so our media server would
    sit idle.
  - Extra process boundaries add failure modes that threaten the stability
    target.
- **Consequences:** the separation is logical (modules), not physical. The
  write-up's "path to production" describes splitting it at scale.
- **Status:** Implemented
- **Evidence:** Control module: `server/src/Workbench.Api/Control/` (`CascadeSession`, `CascadeProviderFactory`) and `Endpoints/`. Media module: `server/src/Workbench.Core/Pipeline/CascadeTurnPipeline.cs` and `Workbench.Providers`. Production split: `docs/comparison.md` "Path to production", `docs/architecture/hla.md`.

### D-05 · Realtime: browser connects directly to OpenAI over WebRTC
- **Basis:** "OpenAI Realtime API (model: gpt-realtime) required for Realtime
  mode."
- **Mechanism:** the backend mints a short-lived client secret; the API key
  never reaches the browser.
- **Alternatives:** a backend WebSocket relay (more control and logging, but
  an extra hop).
- **Consequences:** lowest latency for Realtime. The cascade pays an extra
  backend hop, and the write-up must disclose it. Realtime internals are not
  observable (see D-16).
- **Status:** Implemented
- **Evidence:** `server/src/Workbench.Api/Endpoints/RealtimeEndpoints.cs`, `server/src/Workbench.Providers/OpenAI/RealtimeSessionClient.cs`, `client/src/transports/realtime/RealtimeTransport.ts`. Tests: `RealtimeSessionEndpointTests.Mints_a_push_to_talk_session_and_never_returns_the_api_key`; `e2e/realtime.spec.ts` "EN clip -> Spanish audio and transcripts, first_audible recorded" (live API).

### D-06 · Cascade runs on the backend; the browser streams PCM16 over WebSocket
- **Basis:** the provider-abstraction and per-stage instrumentation
  requirements.
- **Alternatives:** run the cascade in the browser (exposes provider keys,
  weaker resilience).
- **Consequences:** keys, retries, and stage timing all live in one process.
- **Status:** Implemented
- **Evidence:** `server/src/Workbench.Api/Control/CascadeSession.cs` (`/ws/cascade`), `client/src/transports/cascade/CascadeTransport.ts`. Tests: `CascadeSocketTests.A_cascade_turn_works_end_to_end_over_the_socket_with_fakes`; `e2e/cascade-real.spec.ts` "EN clip -> Spanish, ES clip -> English, with every stage timed".

### D-07 · One transport interface and one normalized event schema
- **Decision:** the UI is mode-agnostic. Events: `source.*`, `target.*`,
  `audio.chunk`, `stage.timing`, typed `error`. Every event carries `turnId`.
- **Basis:** the code quality expectation of transport/UI separation;
  criterion 4 (mode toggle).
- **Consequences:** a mode switch closes one transport and opens the other;
  the transcript store persists.
- **Status:** Changed (extended)
- **Evidence:** `client/src/transports/types.ts` (`InterpreterTransport`), `client/src/contracts/events.ts`, `server/src/Workbench.Core/Events/WorkbenchEvents.cs`. Adds `segment.commit` and `provider.failover` (C-02). Tests: `EventContractTests.Every_event_type_has_a_sample`; `e2e/ui-walkthrough.spec.ts` "mode switch mid-turn is queued..." (transcripts kept across switches).

### D-08 · Providers behind interfaces; defaults Deepgram, OpenAI, ElevenLabs, DeepL
- **Decision:**
  - Streaming STT: Deepgram.
  - LLM translation: OpenAI, streamed.
  - Streaming TTS: ElevenLabs.
  - DeepL: second translation adapter and the failover target.
- **Basis:** "Provider abstractions... swapping a provider should be a
  contained change." The brief lists these providers as options.
- **Alternatives:**
  - Consolidate through OpenRouter (3 keys: OpenAI, Deepgram, OpenRouter).
    Rejected to keep the four agreed keys.
  - OpenRouter STT is file-based, so it can't stream.
  - OpenAI TTS instead of ElevenLabs.
- **Consequences:** four API keys. The DeepL swap run is the evidence for
  provider flexibility.
- **Status:** Implemented
- **Evidence:** `server/src/Workbench.Core/Contracts/Providers.cs`; adapters in `Workbench.Providers/{Deepgram,OpenAI,ElevenLabs,DeepL}/`, each with doc URLs at the top. Tests: `ProviderContractTests` (live, skipped without keys), `CascadeProviderFactoryTests.Config_alone_swaps_the_default_translator`. Swap evidence: `harness/results/report.md` (cascade-deepl).

### D-09 · Two push-to-talk buttons, one per speaker, each bound to a language
- **Basis:** criterion 5 (language pair selection). Also gives deterministic
  turn boundaries for fair latency measurement.
- **Alternatives:**
  - A single button plus a direction toggle (the original design).
  - Hands-free VAD.
  - Per-turn language identification.
- **Why:**
  - No direction flip before every turn, so no wrong-language turns.
  - No language ID needed.
  - Mic capture is muted during playback, so no echo loop.
  - Floor deny is intuitive, because the listener's own button is the one
    that gets denied.
- **Consequences:** the write-up must acknowledge that push-to-talk is less
  natural than hands-free.
- **Status:** Implemented
- **Evidence:** `client/src/ui/TalkButton.tsx`, `client/src/ui/SpeakerStage.tsx`, `client/src/state/turnMachine.ts`. Tests: `e2e/audio-engine.spec.ts` "keyboard hold (Space) runs a turn", `client/src/state/turnMachine.test.ts`. Push-to-talk being less natural than hands-free is acknowledged in `docs/comparison.md` Disclosures (added in the conformance fix).

### D-10 · Consecutive playback: interpretation plays on button release
- **Decision:** translation and TTS run while the speaker is still talking.
- **Basis:** a "back-and-forth conversation" (the stability benchmark).
- **Alternatives:** simultaneous playback while the speaker talks (requires
  headphones).
- **Consequences:**
  - No echo.
  - The cascade can pre-synthesize audio during speech, while Realtime
    starts generating only after the commit. That favors the cascade on the
    headline metric, and the write-up must disclose it.
- **Status:** Implemented
- **Evidence:** `server/src/Workbench.Core/Pipeline/CascadeTurnPipeline.cs` (translation and TTS per committed segment during capture), `client/src/transports/cascade/CascadeTransport.ts` (playback starts on release). Test: `CascadePipelineTests.Translation_and_tts_stream_before_the_turn_ends`. Disclosed in `docs/comparison.md` "Consecutive playback favors the cascade".

### D-11 · Floor deny with a deny tone; no queuing
- **Decision:** a press while the floor is busy is denied with a short
  generated two-note tone, a button shake, and a "Floor busy" label.
  - No queuing: the speaker releases and presses again.
  - No talk-permit tone: a grant is shown visually only.
- **Scope note:** the control-room prompt said "Finalizing or Playing." The
  UI design session widened it to include Capturing, so the *other* speaker
  pressing while one holds the floor is also denied.
- **Basis:** the turn model (D-09, D-10) and the stability target.
- **Alternatives:** interrupt and cancel playback; queued floor requests.
- **Consequences:** fully deterministic turns. Interrupt is listed as a
  future enhancement. `floor.denied` is logged, not tracked as a metric.
- **Status:** Changed in planning (widened to Capturing); implemented as widened
- **Evidence:** `client/src/state/turnMachine.ts` (`BUSY` = Capturing, Finalizing, Playing), `client/src/audio/denyTone.ts`. Tests: `client/src/state/turnMachine.test.ts` "deny in Capturing", "deny in Finalizing", "deny in Playing"; `client/src/audio/denyTone.test.ts`; `e2e/audio-engine.spec.ts` "a press by the other speaker during a turn is denied, with no first_audible from the tone". The widening was not routed to the owner (C-01).

### D-12 · Mode switching is queued until the turn ends
- **Basis:** criterion 4: "mid-session or pre-session."
- **Alternatives:** "Cancel turn and switch now" (it was in the original
  design and was removed).
- **Consequences:** no mid-turn teardown. The pending-switch banner offers
  "Stay on {current}".
- **Status:** Implemented
- **Evidence:** `client/src/state/turnMachine.ts` (`pendingMode`), `client/src/ui/StatusBanners.tsx` ("Stay on {mode}"). Tests: `client/src/state/turnMachine.test.ts` "switch mid-turn is queued", "queued switch applies when the turn ends", "'Stay on current' cancels the queued switch"; `e2e/ui-walkthrough.spec.ts` "mode switch mid-turn is queued, then Realtime runs a turn, then back to Cascade".

### D-13 · Cascade commit policy: `segment` baseline, `clause` optimization
- **Decision:** commit each STT-finalized segment *during* speech (baseline).
  Commit at clause boundaries within stable partials (optimization). The
  policy is a pure function, selectable, and recorded on every run.
- **Basis:** "Streaming throughout the cascade pipeline (no full-utterance
  blocking)"; the cascade target of under 3s, stretch under 2s.
- **Alternatives:** commit on endpoint (end of utterance). Rejected, because
  with push-to-talk it means full-utterance blocking.
- **Consequences:** the commit policy is the main experimental variable.
- **Status:** Implemented
- **Evidence:** `server/src/Workbench.Core/Commit/CommitPolicies.cs` (segment and clause policies, `ICommitPolicyFactory`); strategy recorded in `RunConditions.strategy` (`client/src/state/metrics.ts`). Tests: `CommitPolicyTests` (e.g. `Commits_each_final_segment_during_speech_and_ignores_interim_revisions`, `Commits_a_clause_once_its_boundary_is_stable_then_the_remainder_on_final`). Measured: `harness/results/report.md`, cascade-segment vs cascade-clause.

### D-14 · T0 is acoustic speech end, not button release
- **Basis:** "speech end → first audio out."
- **Alternatives:** release as T0. Rejected: it understates latency by the
  time a speaker keeps holding the button after they stop talking.
- **Consequences:** a client-side energy detector. Release is recorded as a
  separate mark, and the release lag is visible.
- **Status:** Implemented
- **Evidence:** `client/src/audio/energyDetector.ts`; `client/src/session/controller.ts` `completeRelease` sets `t0` (capped at release). Tests: `client/src/audio/dsp.test.ts` "EnergyDetector"; `e2e/audio-engine.spec.ts` "replay produces press, access, T0 and release marks in order". Release lag reported in `harness/results/report.md`.

### D-15 · Metrics mapped tightly to the brief, using 3GPP terms where they fit
- **Decision:**
  - Mouth-to-ear latency (3GPP KPI 3, adapted): T0 → first audible
    interpreted audio. This is the headline metric.
  - The same metric broken down per stage.
  - Access time (3GPP KPI 1): press → audio flowing.
  - Stability: disconnects, recovery time, playback buffer depth, memory
    growth.
  - Report p50/p95.
- **Dropped:** session ready time, mode switch time, segment-level
  mouth-to-ear, late call entry, availability, floor-denial metrics,
  transmit time limit (no talk cap), audit recording.
- **Basis:** the brief's performance benchmarks and criterion 7. The user's
  instruction: "tight mappings to the requirements."
- **Status:** Implemented; one cell partial
- **Evidence:** `client/src/state/metrics.ts` (`mouthToEarMs`, access, stage marks), `client/src/ui/LatencyPanel.tsx`, `harness/report.ts`, `harness/soak.harness.ts`. Partial: playback buffer depth over time is measured for the cascade only. For Realtime, the browser owns the jitter buffer; since the product follow-ups, WebRTC `getStats()` gives its average delay and concealment per turn (`client/src/transports/realtime/rtcStats.ts`, `rtcStats.test.ts`, e2e mode-switch test).

### D-16 · Realtime internal stages are shown as "hidden," never estimated
- **Basis:** criterion 7 and the controllability dimension.
- **Consequences:** this asymmetry is itself a controllability finding.
- **Status:** Implemented
- **Evidence:** `client/src/ui/LatencyPanel.tsx` (Realtime rows are `"hidden"`), `harness/report.ts` (no estimates). Stated in `docs/comparison.md` section 4.

### D-17 · Quality is "subjective + WER," defined honestly per mode
- **Decision:**
  - Cascade source WER vs. the reference transcript.
  - Target WER vs. the reference translation (labelled a crude proxy).
  - A rubric (accuracy, completeness, fluency), including "answered instead
    of interpreted."
  - An automated judge plus a human spot-check.
- **Basis:** "interpretation quality (subjective + WER)."
- **Consequences:** Realtime's source transcript comes from a side
  transcription process, so its WER does not measure what the model
  understood. Disclose this.
- **Status:** Implemented
- **Evidence:** `harness/metrics.ts` (`wer`, answered-instead heuristic), `harness/report.ts` (automated judge gpt-4.1-mini, cached in `harness/results/judge-cache.json`). Tests: `harness/metrics.test.ts` "normalize / wer", "answered instead of interpreted". Human spot-check: 20 turns scored blind by the owner, `harness/results/human-scores.json` (44 of 60 scores identical to the judge, all within one point).

### D-18 · Fair comparison: identical input, identical clock, recorded run conditions
- **Decision:**
  - The replay harness feeds the same clips to both modes.
  - Both modes use one browser clock and the same marks.
  - Every turn and every export records its run conditions.
- **Basis:** the purpose of the brief: a defensible comparison.
- **Status:** Implemented; schema deviation resolved for new runs (C-09)
- **Evidence:** Replay input through the capture graph (`client/src/session/controller.ts` `runReplayTurn`, `harness/run.harness.ts`); one browser clock for all marks; `RunConditions` on every turn and export (`client/src/state/metrics.ts`; test "records every mark per turn with run conditions, first write wins"). The shape differs from measurement-protocol section 6: no `runId`, `build` sha or `failover` field (C-09).

### D-19 · Cost per minute from logged usage times a dated pricing table
- **Basis:** the "cost per minute" impact metric.
- **Alternatives:** a live cost meter in the UI (cut: not a must-have).
- **Status:** Implemented; DeepL price unverified
- **Evidence:** `harness/pricing.json` (OpenAI, Deepgram and ElevenLabs verified on their pricing pages 2026-10-15, Deepgram's rate a promotion; DeepL unverified), `harness/metrics.ts` `turnCost`. Tests: `harness/metrics.test.ts` "turnCost" (cascade, DeepL, Realtime).

### D-20 · Warm-up and press-to-warm
- **Decision:** connections and providers are warmed on page load and after
  a mode switch. The STT stream opens on press.
- **Basis:** keeps cold starts out of the first turn and out of p95.
- **Status:** Implemented
- **Evidence:** `client/src/session/controller.ts` `warm` then `WARM_DONE`; the talk buttons show "Not ready" until then (`client/src/state/turnMachine.test.ts` "press while Warming is 'Not ready'"). Press-to-warm: `CascadeSession.StartTurnAsync` opens the STT stream on `turn.start`; Deepgram connect retry in `server/src/Workbench.Providers/Deepgram/DeepgramSttProvider.cs`.

### D-21 · The deny tone never counts as first audible
- **Basis:** measurement integrity. An earcon must not shorten "first audio
  out."
- **Status:** Implemented
- **Evidence:** `client/src/audio/denyTone.ts` routes the tone straight to the destination, never through the playback tap; `client/src/session/controller.ts` `denyToneWindow` also keeps it out of the energy detector (commit 28e4ab0). Tests: `client/src/audio/denyTone.test.ts` "never produces first_audible..."; the floor-deny test in `e2e/audio-engine.spec.ts`.

### D-22 · Secrets in a gitignored `.env` that the agent is denied from reading
- **Decision:** the backend loads `.env` via DotNetEnv, and real environment
  variables take precedence.
- **Alternatives:** system environment variables via `setx` (the first
  pack); `dotnet user-secrets` (needs the project to exist first).
- **Status:** Implemented
- **Evidence:** `server/src/Workbench.Api/Config/DotEnvLoader.cs` (real environment variables win), `scripts/env.mjs` (dotenv), `.gitignore`, `.env.example`, `.claude/settings.json` deny rules. Test: `HealthEndpointTests.Reports_missing_key_names_and_never_values`.

### D-23 · Workbench scope filter
- **Decision:** every feature must satisfy a success criterion or fill a
  cell in the comparison matrix: latency, quality, cost, controllability,
  provider flexibility, time to onboard a language pair.
- **Out of scope:**
  - live shadow mode
  - hands-free mode
  - full-duplex talk-over
  - in-UI cost meter
  - session health strip
  - earcons in metrics
  - glossary UI (glossary only as a stretch goal)
- **Status:** Implemented; changed once after the build
- **Evidence:** `docs/requirements.md` traces each feature to a criterion or matrix cell. Changed by C-12 (Clinic terms toggle). Still out of scope and absent from the code: shadow mode, hands-free, full duplex, cost meter, health strip, glossary editing UI.

### D-24 · Synthetic speech clips for evaluation
- **Decision:** TTS-generated EN and ES clinic sentences with reference
  transcripts and translations, generated once and cached.
- **Consequences:** synthetic speech is cleaner than human speech. Disclose
  this, and complement it with a live-voice session.
- **Status:** Implemented; live-voice complement not recorded
- **Evidence:** `harness/scripts.json` (24 clinic sentences plus 4 FR), `harness/generate-clips.ts`, `harness/clips/` (generated once). Disclosed in `docs/comparison.md`. No live-voice session is recorded in `harness/results/` (`docs/status.md`).

### D-25 · Evidence runs for flexibility and onboarding
- **Decision:**
  - A cascade run with DeepL as the primary translator (a config-only
    change).
  - An EN↔FR onboarding exercise that records the files touched and the
    effort per architecture.
- **Basis:** the impact metrics "provider flexibility" and "time to onboard
  a new language pair."
- **Status:** Implemented
- **Evidence:** DeepL: harness config `cascade-deepl` (`harness/lib.ts`, URL `?providers=translation:deepl`), results in `harness/results/report.md`. Onboarding: `harness/onboarding.harness.ts`, `harness/results/onboarding.md` (one config change).

### D-26 · UI follows the approved design
- **Decision:**
  - Boostlingo logo plus a "not an official Boostlingo product" disclaimer.
  - Three-column layout.
  - Waterfall labelled "final segment from T0" (now one per mode, side by side: C-22).
  - p50/p95 table colored against targets.
  - Export button.
  - One state per error code.
- **Basis:** criteria 5, 6, 7; error-handling expectations.
- **Status:** Implemented
- **Evidence:** `client/src/ui/Header.tsx` (logo, disclaimer); `client/src/styles.css` `.columns` (three columns from 1200 px, two below, one under 760 px); `client/src/ui/LatencyPanel.tsx` ("final segment from T0" waterfall, p50/p95 table, Export); `e2e/error-states.spec.ts` (one test per error code); `e2e/ui-walkthrough.spec.ts` "phone width...".

### D-27 · Development process: one unattended run driven by PROGRESS.md
- **Decision:** a single overnight Claude Code run from a prepared pack
  (CLAUDE.md, PROGRESS.md, architecture, UI spec, design), with PROGRESS.md
  as the queue and memory.
- **Alternatives:** the control-room loop (DOCS / NEXT / REVIEW per
  milestone in the Claude Project).
- **Consequences:**
  - No per-milestone prompts or human review cycles, so `docs/agent-log/`
    was not produced by the run.
  - The milestone order differs from the control-room plan.
  - The conformity check moved to after the run, where it found the doc
    pack gaps.
- **Status:** Implemented
- **Evidence:** `KICKOFF.md`, `PROGRESS.md` (session log), git history (`docs/build-plan.md`). Consequences confirmed: no per-milestone agent log during the run, milestone order changed (C-03), conformity check after the run (`docs/conformance.md`).

---

## Changes during the build
(Filled from PROGRESS.md "Decisions made during the run" and git history:
ID, what changed, why, brief impact.)

Brief impact is relative to the `docs/brief.md` success criteria and the
comparison matrix. "Not routed" means the change was made without going to
the owner first, which the control-room guardrails required for locked
decisions.

| ID | Decision | What changed | Why | Brief impact | Evidence |
|---|---|---|---|---|---|
| C-01 | D-11 | Floor deny also covers Capturing (the control-room prompt said Finalizing or Playing). Made in the UI design session and carried into CLAUDE.md. Not routed. | The other speaker pressing while one holds the floor must not start an overlapping turn. | None negative: turns stay deterministic. | `client/src/state/turnMachine.test.ts` "deny in Capturing" |
| C-02 | D-07 | Two events beyond the planned schema: `segment.commit` (Commit chip) and `provider.failover` (failover note). `audio.chunk` carries base64 PCM16 in JSON. | The UI shows what the policy released and when failover happened. | Supports criterion 7 and the controllability cell. | `EventContractTests`, `contracts/event-samples.json` |
| C-03 | D-27 | The milestone order differs from the control-room plan (table below). Not routed. | One unattended run; the UI came before the harness so the harness could drive the real UI. | Order only: every planned item was built. | `docs/build-plan.md` |
| C-04 | D-08 | Translation model `gpt-4.1-nano`, which planning left open. | Lowest measured first-token time (about 360-400 ms) with the same output. | Helps cascade latency (criterion 3; < 2 s stretch met). | PROGRESS.md M4, `OpenAI:TranslationModel` |
| C-05 | D-13 | Deepgram end of turn by audio coverage (a final's end time reaches the audio sent), not by the Finalize reply alone. | Measured: Finalize only covers audio already processed. | Prevents truncated last segments. | `server/src/Workbench.Providers/Deepgram/DeepgramSttProvider.cs`, `ProviderContractTests.Deepgram_transcribes_the_fixture_and_finalizes_on_release` |
| C-06 | D-08 | A custom `FailoverCircuit` (open for 60 s after the 429 retry budget) instead of Polly's breaker; Polly still retries with jitter. | Polly's breaker needs a sampling window that does not fit "open after repeated 429s". | Meets the resilience expectation. | `Workbench.Providers/Resilience/`, `CascadeSocketTests.Injected_fake_429s_fail_over_and_surface_on_the_socket` |
| C-07 | D-13 | No retry on the STT final timeout; the policy flushes what was heard. The pre-build spec said "one retry". | After release there is no audio left to resend. | None. | PROGRESS.md M3 |
| C-08 | D-18 | The harness uses the app's Replay input instead of Playwright fake audio capture (measurement-protocol section 7). | The fake capture file loops from browser start and cannot be aligned with a press. | Same capture path as the mic, so fairness holds. | `harness/run.harness.ts`, `client/src/session/controller.ts` `runReplayTurn` |
| C-09 | D-18 | Run conditions as built: `mode, strategy, providers[], pair, direction, inputSource, controls` per turn, plus `startedAtIso` and `failoverNote` on the turn and `startedAt`, `browser`, `pageReloads` per run file. No `runId` or `build` sha. | The record grew with the turn store; the protocol schema was written after the build. | Resolved for new runs: `runId` and `build` were added in the product follow-ups (`HealthEndpointTests.Reports_the_build_commit_so_runs_can_be_traced_to_code`, `e2e/ui-walkthrough.spec.ts`); older runs show an inferred build. | `client/src/state/metrics.ts` `RunConditions` |
| C-10 | D-15 | The soak reports the post-GC heap floor (first vs last minute) next to the raw start and end. | The raw heap saw-tooths without forced GC. | Memory growth stays visible (post-GC floor +4.9 MB Realtime, +3.7 MB cascade over 45 turns; unresolved). | `harness/soak.harness.ts`, `harness/report.ts` |
| C-11 | D-02 | .NET 10 SDK installed repo-local in `.dotnet/` (gitignored) and launched by `scripts/dotnet.mjs`. | No SDK on the machine, and no global installs allowed. | None. | PROGRESS.md M0 |
| C-12 | D-23 | Translation controls (formal register + clinic glossary) after the run, then a header "Clinic terms" toggle and a per-turn tag. Requested by the owner. | The evaluation found informal *tu* and "receta" rendered as *recipe*. | Strengthens controllability and the recommendation with measured evidence. Glossary editing UI stays out. | `docs/translation-controls.md`, `client/src/ui/Header.tsx`, `TranslationControlsTests` |
| C-13 | D-15 | Realtime first-audible is not corrected for output latency (the cascade mark includes it, the Realtime mark does not). | A correction would be an estimate in a measured-only report. | Small bias toward Realtime, disclosed. | `docs/comparison.md` disclosures |
| C-14 | D-14 | T0 is stamped on the capture clock and frames in flight at release are flushed before finalizing; the deny tone window is excluded from the detector. | A subagent review found a T0 clock bias and a press/release race. | Measurement integrity. | commits 99d7815, 28e4ab0 |
| C-15 | D-11 | A floor deny is logged to the console only. The `floor.denied` event type exists in both contracts but is never sent or stored. | D-11 says deny is "logged, not tracked as a metric". | None. | `client/src/session/controller.ts` `perform` (`floorDenied`) |
| C-16 | D-12 | A mode switch also applies at once while Warming, and from the Error state for `config_error` and `internal` (the other mode may work). The spec said only in Ready. | A failed or unconfigured mode must not trap the user. | Criterion 4 still holds: switching mid-turn is queued. | `client/src/state/turnMachine.test.ts` "switch escapes a config error...", "switch escapes a failed warm-up" |
| C-17 | D-08 | Failover covers translation only (the only stage with a second provider). TTS has Polly retry but no fallback; STT is outside Polly, and Deepgram's connect has its own 2-retry loop with jitter. The breaker is shared per real provider across sessions. | Only DeepL was planned as a secondary provider. | Matches the brief's "DeepL failover on repeated 429s". | `server/src/Workbench.Providers/Resilience/`, `DeepgramSttProvider.cs` |
| C-18 | D-20 | Two timeouts beyond the spec: a 5 s stalled-stream timeout (`StreamIdleTimeout`) and a 5 s Realtime wait for `response.created`. The STT final timeout (2 s) keeps the last partial and reports `provider_timeout` only if nothing was translated. | Found in the M7 review: a stalled stream or a lost response hung the floor. | Supports the timeout handling expectation. | commits a2992e0, 28e4ab0 |
| C-19 | D-07 | No separate session state machine (the spec's Idle -> Warming -> Ready -> Closed). Session state is the turn phase plus the error code plus the transport connection state. | One reducer (`turnMachine.ts`) already carries Warming, Ready and Error; a second machine would duplicate it. | None on the criteria; documented in `docs/architecture/lla.md`. | `client/src/state/turnMachine.ts`, `client/src/session/controller.ts` |
| C-20 | D-08 | The DeepL key is optional: without it the cascade runs with no failover, and Realtime needs only the OpenAI key. | A missing failover key should not block the primary path (M7 review). | Resilience degrades to retry-only without the key; `/api/health` reports it per mode. | `HealthEndpointTests.A_missing_DeepL_key_blocks_neither_mode_and_Realtime_needs_only_OpenAI` |
| C-21 | D-20 | Cascade warm-up is best effort (5 s): pooled HTTP connections plus a key check per provider (the Deepgram socket opens on press), with a keep-warm every 45 s while idle. | Deepgram streams are per turn; idle sockets would time out. | Cold starts stay out of p95 (press-to-warm). | `docs/architecture/lla.md` resilience and warm-up sections |
| C-22 | D-26 | The single "Last turn" card became a full-width "Compare modes" row: one block per mode (latest turn of each), with its input, extra timing marks (release lag, release to first audible, translate done, segments), turn cost and text. Requested by the owner. | A workbench should let the same clip be read across both architectures side by side; one card showed only the last mode used. | Strengthens criterion 7 and the latency and cost cells; no scope change. | `client/src/ui/ModeComparison.tsx`, `e2e/ui-walkthrough.spec.ts` |
| C-23 | D-23, D-26 | A Test Runs tab: a tester runs chosen replay clips on one setup (Realtime or one of three cascade options, Clinic terms on or off), and every run is saved to `harness/results/test-runs/` with its turns and summary; saved runs can be opened and compared per clip. Requested by the owner. | Repeatable measurements without the command-line harness, kept and comparable. | Serves the latency, quality and cost cells; the LLM judge stays offline (it costs per turn). Runs started by a tester are outside the agent's harness budget and show a cost estimate and a confirmation first. | `client/src/ui/TestRuns.tsx`, `client/src/session/TestRunner.ts`, `client/src/session/testRun.test.ts`, `TestRunEndpointTests`, `e2e/test-runs.spec.ts` |

### Milestone order: control-room plan vs. run

| # | Control-room plan | As run (`PROGRESS.md`) |
|---|---|---|
| M0 | Scaffold and event schema | Scaffold, event contract, .env loading, health and config_error |
| M1 | Audio engine, push-to-talk, replay source | Audio engine, floor machine, metrics store, talk buttons, simulated transport |
| M2 | Realtime end to end with timing marks | Realtime end to end (same) |
| M3 | Cascade with fake providers, plus tests | Cascade core with fakes, Polly retry and DeepL failover breaker |
| M4 | Real adapters with segment commit, < 3 s | Real adapters (all four); clip generation pulled forward |
| M5 | Clause commit and the DeepL adapter, toward < 2 s | Full UI per spec with every error state (clause and DeepL were already built in M3 and M4) |
| M6 | Error handling and floor-deny UX | Evaluation harness, soak and onboarding (error handling came in M3 and M5, floor deny in M1) |
| M7 | Soak, harness report, comparison write-up | Review, pooled report, comparison, README, MORNING (the soak moved to M6) |

Detail for C-12:

- **D-23 change · Clinic terms toggle (after the build, at the user's request).**
  The evaluation found two clinic errors (informal *tú*, "receta" →
  *recipe*), fixed by the translation controls
  ([translation-controls.md](translation-controls.md)). A header On/Off toggle
  and a per-turn "Clinic terms on" / "Clinic terms off" tag make that fix
  visible and demonstrable. Still out of scope: glossary editing in the UI
  and highlighting glossary terms in transcripts. Evidence:
  `client/src/ui/Header.tsx`, `client/src/ui/Transcripts.tsx`,
  `e2e/ui-walkthrough.spec.ts`.

# Requirements traceability

Every requirement in [`brief.md`](brief.md) → where it is implemented → the test that proves it →
the evidence → status. Test names are xUnit (`server/tests/Workbench.Tests`), vitest (`client/src`,
`harness/`), and Playwright (`e2e/`). Report sections refer to
[`harness/results/report.md`](../harness/results/report.md).

Status: **Met** (evidence linked) · **Partial** (see note) · **Not met**. No row is Met without a
test, a measurement or a reproducible check.

## Functional requirements (must-haves)

| # | Requirement | Implemented in | Proved by | Evidence | Status |
|---|---|---|---|---|---|
| F1 | Browser SPA with microphone capture and audio playback | `client/src/audio/captureEngine.ts` (mic → capture worklet), `audio/player.ts` + `worklets/playback.worklet.ts`, `transports/realtime/RealtimeTransport.ts` (remote audio element) | e2e `audio-engine.spec.ts` "keyboard hold (Space) runs a turn" (fake mic device); every replay spec plays through the same capture graph | Playwright passes on every e2e spec (capture and playback through the real audio graph); harness runs: 72 Realtime and 144 cascade turns played back with `firstAudible` recorded (report §1) | Met |
| F2 | Realtime mode with `gpt-realtime`, voice in / voice out | `server/.../OpenAI/RealtimeSessionClient.cs` (client secret, model `gpt-realtime`), `RealtimeTransport.ts` (WebRTC to `/v1/realtime/calls`), `eventMapper.ts` | e2e `realtime.spec.ts` "EN clip -> Spanish audio and transcripts, first_audible recorded"; xUnit `Mints_a_push_to_talk_session_and_never_returns_the_api_key`; vitest `eventMapper.test.ts` | report §1 Realtime rows (24 live turns) | Met |
| F3 | Cascade mode: STT → Translation → TTS with streaming, no full-utterance blocking | `server/src/Workbench.Core/Pipeline/CascadeTurnPipeline.cs`, `Commit/CommitPolicies.cs`, adapters in `Workbench.Providers` | xUnit `Translation_and_tts_stream_before_the_turn_ends`, `Events_are_ordered_and_every_event_carries_the_turn`; e2e `cascade-real.spec.ts` | report §1 cascade rows and server stage durations; segments are translated and synthesized while the speaker talks (clause mode reached first audio at release on longer sentences) | Met at segment granularity: TTS starts per committed segment once its translation is complete, not mid-segment |
| F4 | UI toggle to switch modes, pre-session or mid-session | `ui/Header.tsx` (mode toggle), `state/turnMachine.ts` (switch queued until Ready), `ui/StatusBanners.tsx` (pending banner, "Stay on …") | vitest `turnMachine.test.ts` ("switch mid-turn is queued", "queued switch applies when the turn ends"); e2e `ui-walkthrough.spec.ts` "mode switch mid-turn is queued, then Realtime runs a turn, then back to Cascade" | Playwright | Met |
| F5 | Language pair selection, minimum EN ↔ ES | `appsettings.json` `Languages`, `GET /api/config`, `ui/Header.tsx` pair selector, per-speaker direction | xUnit `Config_lists_the_default_english_spanish_pair`; e2e `cascade-real.spec.ts` (both directions) | report §1 "By direction"; onboarding.md (EN ↔ FR added by config) | Met |
| F6 | Live source and target transcripts as produced | `ui/Transcripts.tsx` (live card: stable vs partial words, streaming target with caret), `source.partial/final`, `target.partial/final` events | xUnit `Events_are_ordered...` (cumulative partials); e2e walkthrough + realtime spec (source text arrives after audio and is shown when it arrives) | Playwright | Met |
| F7 | Per-stage latency visible to the user | `ui/LatencyPanel.tsx` (headline, waterfall, p50/p95 table, export), `stage.timing` events | e2e walkthrough ("latency panel and p50/p95"); vitest `metrics.test.ts` | `e2e/ui-walkthrough.spec.ts` asserts the headline latency, the "TTS first byte" waterfall row and the p50/p95 table count | Met |
| F8 | Comparison write-up (latency, quality, cost, controllability, recommendation) | [`docs/comparison.md`](comparison.md) | Every number traced to `harness/results/report.md`; checked in [`conformance.md`](conformance.md) | comparison.md sections 1-8, disclosures, path to production | Met |

## Performance benchmarks

| # | Requirement | Implemented in | Proved by | Evidence | Status |
|---|---|---|---|---|---|
| P1 | Realtime < 1.5 s speech end → first audio | Realtime transport; T0 energy detector; AnalyserNode first-audible tap | harness `run.harness.ts` (24 clips) | report §1: pooled 72 turns p50 1.09 s, p95 1.46 s; per-run p95 1.06 / 1.72 / 1.36 s | Met pooled, narrowly (one of three runs alone missed it: vendor-side variance) |
| P2 | Cascade < 3 s, target < 2 s with full streaming | cascade pipeline, warm-up, press-to-warm, consecutive playback | harness (segment, clause, DeepL configurations) | report §1: pooled 48 turns each, segment p95 1.89 s, clause p95 1.44 s, DeepL p95 1.25 s, all under 2 s | Met (stretch met too) |
| P3 | 5-minute back-and-forth without disconnects, audio drift or memory leaks | reconnect (1-5) in both transports, bounded channels, jitter buffer, per-turn cleanup | `soak.harness.ts` (5 min per mode, forced drop at midpoint) | report §5: 45 turns/mode, 0 failed, 0 unplanned disconnects, forced-drop recovery 2.1 s / 1.1 s, 0 underruns (cascade), heap floor +4.9 MB (Realtime) / +3.7 MB (cascade) over 45 turns | Met for 5 min (a slow leak beyond 5 min is not ruled out) |

## Code quality expectations

| # | Requirement | Implemented in | Proved by | Evidence | Status |
|---|---|---|---|---|---|
| Q1 | Clean separation: mode-specific transport vs mode-agnostic UI | `transports/types.ts` (`InterpreterTransport`, `TransportSink`), `session/controller.ts`, `ui/*` import no transport | event contract tests (C# `EventContractTests`, TS `events.test.ts`) | code layout; README "Architecture" | Met |
| Q2 | Provider abstractions; swapping is a contained change | `ISttProvider`, `ITranslationProvider`, `ITtsProvider`, `ICommitPolicy`; `CascadeProviderFactory` | harness `cascade-deepl` configuration (URL/config only); xUnit `CascadeProviderFactoryTests` (`Config_alone_swaps_the_default_translator`, `Resolve_uses_config_defaults_and_applies_per_session_overrides`) | report §4 (provider swap) | Met |
| Q3 | Targeted tests on the cascade pipeline and provider boundaries | `CascadePipelineTests`, `CommitPolicyTests`, `CascadeSocketTests`, `ProviderContractTests`, `RealtimeSessionEndpointTests` | `npm test` | test output | Met |
| Q4 | Error handling: rate limits, timeouts, empty results, mic denied | resilience decorators (Polly retry with jitter, first-item and stalled-stream timeouts), `FailoverCircuit`, Deepgram connect retry, STT final watchdog, Realtime response-start timeout, error taxonomy, UI states | xUnit `Repeated_429_retries_with_backoff_then_fails_over_to_deepl_and_records_it`, `Translation_timeout_retries_once_then_reports_provider_timeout`, `A_stream_that_stalls_after_its_first_token_is_a_provider_timeout`, `Empty_stt_result_is_a_neutral_empty_result`; e2e `error-states.spec.ts` (one test per code), `mic-denied.spec.ts` | Playwright | Met |
| Q5 | README with setup, run, architecture | [`README.md`](../README.md) sections Setup, Run, Architecture (Mermaid), Why C# / .NET | Reproducible check: `npm run dev` from the README started a healthy app (`/api/health` status ok, 2026-10-15) | README.md; [`architecture.md`](architecture.md) index | Met |
| Q6 | AGENTS.md / CLAUDE.md describing agent usage | [`CLAUDE.md`](../CLAUDE.md) "How I directed the agent" | One agent-log line per milestone M0-M7 plus follow-ups; prompts recorded in [`agent-log/`](agent-log/) | CLAUDE.md, `docs/agent-log/00-planning-session.md`, `01-overnight-run.md`, `02-conformance-fix.md` | Met |
| Q7 | Scoped commits with meaningful messages, no single dump | git history (conventional commits per milestone) | `git log --oneline` | [`build-plan.md`](build-plan.md) lists every commit per milestone (scaffold to M7 in 38 commits) | Met |

## Other specific requirements

| # | Requirement | Implemented in | Proved by | Evidence | Status |
|---|---|---|---|---|---|
| O1 | Streaming throughout the cascade | Deepgram interim/final stream, Chat Completions SSE, ElevenLabs HTTP streaming, bounded channels between stages | `Translation_and_tts_stream_before_the_turn_ends` | report §1 stage breakdown | Met (DeepL has no streaming API: its segment arrives whole, noted in report §4) |
| O2 | Per-stage latency instrumentation visible in the UI | see F7 | see F7 | `e2e/ui-walkthrough.spec.ts` (waterfall rows and p50/p95 table) | Met |
| O3 | Agentic coding assistant used; git history reflects iterative development | Claude Code, unattended run per KICKOFF.md; per-milestone commits and subagent reviews | Transcript prompts in [`agent-log/`](agent-log/); review fixes visible as `fix(...)` commits (99d7815, 2cc1516, 439ac5f, 28e4ab0, a2992e0) | CLAUDE.md agent log, PROGRESS.md session log, [`build-plan.md`](build-plan.md) | Met |

## Comparison matrix cells (both modes, with evidence)

| # | Cell | Realtime evidence | Cascade evidence | Where written up | Status |
|---|---|---|---|---|---|
| M1 | Latency | report §1: p50 1.09 s / p95 1.46 s (72 turns); stages "hidden" | report §1: segment 1.43 / 1.89 s, clause 1.21 / 1.44 s, DeepL 1.15 / 1.25 s (48 turns each); server stage durations | comparison.md §1 | Met |
| M2 | Quality (subjective + WER) | report §2: target WER 0.097, judge 4.96 / 4.97 / 4.99, answered-instead 0/72 | report §2: source WER 0.000, target WER 0.059-0.293, judge scores, answered-instead 0/48 per config | comparison.md §2 | Partial: "subjective" rests on the automated judge only; the human sheet in MORNING.md is blank |
| M3 | Cost per minute | report §3: $0.210/min (with split) | report §3: $0.043/min (OpenAI), $0.066/min (DeepL) | comparison.md §3 | Partial: prices read 2026-10-15 and marked "verify"; the DeepL rate is unverified |
| M4 | Controllability | Prompt, voice, turn boundaries; internals not observable; prompt-level controls measured (13/14 glossary terms) | Every stage timed and swappable; commit policy measured; formality + glossary enforced (9/9 formal, 14/14 terms) | comparison.md §4, [`translation-controls.md`](translation-controls.md) | Met |
| M5 | Provider flexibility | Model version only | OpenAI -> DeepL by config only: report §4, `CascadeProviderFactoryTests.Config_alone_swaps_the_default_translator` | comparison.md §5 | Met |
| M6 | Time to onboard a language pair | EN<->FR by config, 1.00-1.41 s | EN<->FR by config, 1.28-1.42 s | comparison.md §6, `harness/results/onboarding.md` | Met (one well-supported language; an uncommon pair was not tried) |

## Planning decisions (D-01 to D-27)

Status and evidence per decision are in [`decisions.md`](decisions.md);
this table is the summary. Code-vs-plan differences are C-01 to C-21 in
its "Changes during the build".

| # | Decision | Evidence (short) | Status |
|---|---|---|---|
| D-01 | Brief governs over PRD | README "Why C# / .NET"; conflicts recorded in decisions.md D-01 | Met |
| D-02 | C# / ASP.NET Core + TS / Vite / React | `server/Workbench.sln`, `client/`; `EventContractTests`, `events.test.ts` | Met |
| D-03 | Local install only | `npm run dev`; README Setup / Run | Met |
| D-04 | One process, control + media modules | `Workbench.Api/Control`, `Workbench.Core/Pipeline`; [`architecture/hla.md`](architecture/hla.md) | Met |
| D-05 | Realtime browser-direct over WebRTC, minted secret | `RealtimeSessionEndpointTests.Mints_a_push_to_talk_session_and_never_returns_the_api_key`, `e2e/realtime.spec.ts` | Met |
| D-06 | Cascade on the backend, PCM16 over WebSocket | `CascadeSocketTests.A_cascade_turn_works_end_to_end_over_the_socket_with_fakes` | Met |
| D-07 | One transport interface, one event schema | `EventContractTests.Every_event_type_has_a_sample`; schema extended (C-02) | Met |
| D-08 | Providers behind interfaces; Deepgram, OpenAI, ElevenLabs, DeepL | `ProviderContractTests`, `CascadeProviderFactoryTests` | Met |
| D-09 | Two push-to-talk buttons bound to languages | `e2e/audio-engine.spec.ts` "keyboard hold (Space) runs a turn" | Met |
| D-10 | Consecutive playback on release | `CascadePipelineTests.Translation_and_tts_stream_before_the_turn_ends`; disclosed in comparison.md | Met |
| D-11 | Floor deny with tone, no queuing | `turnMachine.test.ts` deny rows; `e2e/audio-engine.spec.ts` floor-deny test; widened to Capturing (C-01) | Met |
| D-12 | Mode switch queued until the turn ends | `turnMachine.test.ts` switch rows; `e2e/ui-walkthrough.spec.ts` mode switch test | Met |
| D-13 | Segment baseline, clause optimization, recorded per run | `CommitPolicyTests`; report §1 segment vs clause | Met |
| D-14 | T0 is acoustic speech end | `dsp.test.ts` "EnergyDetector"; `e2e/audio-engine.spec.ts` marks test | Met |
| D-15 | Metrics mapped to the brief (KPI 3, KPI 1, stability) | `metrics.ts`, `harness/report.ts`, soak results | Partial: playback buffer depth for the cascade only |
| D-16 | Realtime internals "hidden", never estimated | `LatencyPanel.tsx`; report stage table | Met |
| D-17 | Quality: WER, rubric, answered-instead, judge + human | `harness/metrics.test.ts`; report §2 | Partial: human spot-check not done |
| D-18 | Fair comparison: identical input, one clock, run conditions | Replay harness; `metrics.test.ts` run-conditions test | Partial: run conditions lack `runId` and `build` sha (C-09) |
| D-19 | Cost from logged usage x dated prices | `harness/metrics.test.ts` "turnCost"; report §3 | Partial: prices not verified |
| D-20 | Warm-up and press-to-warm | `turnMachine.test.ts` "press while Warming is 'Not ready'"; `CascadeSession.StartTurnAsync` | Met |
| D-21 | Deny tone never counts as first audible | `denyTone.test.ts` "never produces first_audible..." | Met |
| D-22 | Secrets in gitignored `.env` | `HealthEndpointTests.Reports_missing_key_names_and_never_values`; `.gitignore`; settings deny rules | Met |
| D-23 | Scope filter | This file traces every feature; one owner-approved change (C-12) | Met |
| D-24 | Synthetic clips, cached | `harness/clips/`, `harness/scripts.json`; disclosed | Partial: no recorded live-voice session |
| D-25 | DeepL swap and onboarding runs | report §4; `harness/results/onboarding.md` | Met |
| D-26 | UI follows the approved design | `e2e/error-states.spec.ts`, `e2e/ui-walkthrough.spec.ts` | Met |
| D-27 | One unattended run driven by PROGRESS.md | `KICKOFF.md`, `PROGRESS.md`, [`build-plan.md`](build-plan.md) | Met |

## Follow-up: translation controls (beyond the brief)

| # | What | Implemented in | Proved by | Evidence | Status |
|---|---|---|---|---|---|
| X1 | Formal register and clinic glossary, in both architectures | `TranslationControls` (Core), `DeepLTranslationProvider` (formality + v3 glossary), `InterpreterPrompt.Controls` (OpenAI translator + Realtime), header "Clinic terms" toggle and `?controls=` | xUnit `TranslationControlsTests`, live `DeepLControlsContractTests` (formality, glossary); e2e `ui-walkthrough.spec.ts` (toggle and per-turn tag) | [`translation-controls.md`](translation-controls.md), `harness/results-controls/report.md` | Met (glossary evaluated on the same clips it was written for) |

## Impact metrics (brief, "Key Impact Metrics")

| Metric | Where measured |
|---|---|
| End-to-end latency (ms) | report §1 |
| Cost per minute | report §3 |
| Interpretation quality (subjective + WER) | report §2 (automated judge + WER) and the human scoring sheet in MORNING.md |
| Provider flexibility | report §4 |
| Time to onboard a new language pair | report §6 → onboarding.md |

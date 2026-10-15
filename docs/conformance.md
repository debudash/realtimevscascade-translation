# Conformance check

Re-run on 2026-10-15 at the end of the product rounds (gaps decided by the
owner, Compare modes row, Test Runs and Documentation tabs, live voice),
against (a) the brief's success criteria, (b) the control-room doc pack,
and (c) every planning decision D-01 to D-27. The first run of this check
was after the conformance fix (commit 37127be); this one supersedes it. The
control-room prompt is recorded in
[`agent-log/02-conformance-fix.md`](agent-log/02-conformance-fix.md).

Status: **Met** (evidence linked) · **Partial** (evidence for part) ·
**Missing** · **Justified** (a deliberate, documented deviation).

Checks run for this pass:
- every relative link in README, HANDOFF, CLAUDE, PROGRESS, `docs/**`,
  `harness/README.md` and `harness/live-voice.md` resolves (0 broken);
- no dash-only placeholder evidence cell in `docs/requirements.md`;
- no em dash or prose double hyphen in authored prose (only `docs/brief.md`,
  the source brief, and verbatim prompts in `agent-log/` keep theirs);
- every D-xx in `docs/decisions.md` has a Status and an Evidence line
  (27 / 27); changes during the build C-01 to C-24 each name evidence;
- the as-built architecture docs state the commit they describe and match
  the code (see (b));
- tests: 86 xUnit, 96 vitest, 22 Playwright specs passing (fake providers
  plus live Realtime turns).

## (a) Brief success criteria

| Item | Status | Evidence | Gap |
|---|---|---|---|
| F1 SPA with mic capture and playback | Met | every e2e spec; 216 harness turns and the live session with `firstAudible` | - |
| F2 Realtime with gpt-realtime, voice in / out | Met | `e2e/realtime.spec.ts` (live), `RealtimeSessionEndpointTests`, report §1 and §7 | - |
| F3 Cascade STT -> translation -> TTS, streaming | Met | `CascadePipelineTests.Translation_and_tts_stream_before_the_turn_ends`, `e2e/cascade-real.spec.ts` | Segment granularity by design ([`production.md`](production.md) §2) |
| F4 Mode toggle pre- or mid-session | Met | `turnMachine.test.ts` switch rows, walkthrough mode-switch test | - |
| F5 Language pair, minimum EN<->ES | Met | `Config_lists_the_default_english_spanish_pair`, onboarding.md (EN<->FR) | - |
| F6 Live source and target transcripts | Met | `Events_are_ordered_and_every_event_carries_the_turn`, walkthrough; list scrolls after four | - |
| F7 Per-stage latency visible | Met | Compare modes row (waterfall per mode), p50/p95 table, Test Run summaries; `e2e/ui-walkthrough.spec.ts` | - |
| F8 Comparison write-up, 1-2 pages | Met | `comparison.md`: all matrix cells, live-voice and human-check findings, disclosures, path to production | About 1,800 words: the upper end of 2 pages |
| P1 Realtime < 1.5 s | Met | Pooled p95 1.46 s (72 turns); later Test Runs 1.30 and 1.17 s; live 1.24 s | One early harness run alone 1.72 s (accepted by the owner) |
| P2 Cascade < 3 s, stretch < 2 s | Met | p95 1.89 / 1.44 / 1.25 s (segment / clause / DeepL); live 1.81 s | - |
| P3 5-minute stability | Partial | Soak: 45 turns per mode, 0 failures, 0 unplanned disconnects, drop recovered; Realtime playback health 30 ms jitter buffer, 0% concealed | Heap floor growth over long sessions not ruled out ([`production.md`](production.md) §1) |
| Q1 Transport separated from UI | Met | `transports/types.ts`, contract tests | - |
| Q2 Provider abstractions | Met | `CascadeProviderFactoryTests.Config_alone_swaps_the_default_translator`, report §4; DeepL is a Test Run setup | - |
| Q3 Targeted pipeline and provider tests | Met | see test counts above | - |
| Q4 Rate limits, timeouts, empty, mic denied | Met | `error-states.spec.ts` (one test per code, plus rate-limited with no fallback), `mic-denied.spec.ts` | - |
| Q5 README setup, run, architecture | Met | README sections, Test Runs and "Using the workbench"; Documentation tab in the app | - |
| Q6 CLAUDE.md agent usage | Met | "How I directed the agent" through this round; `agent-log/00` to `04` | - |
| Q7 Scoped, meaningful commits | Met | `build-plan.md` commit table; README "Reading the git history"; bodies on every commit since rule 10 | - |
| Impact: latency, cost, quality, flexibility, onboarding | Partial | report §1-§7, `requirements.md` M1-M6 | DeepL price unverified |

## (b) Control-room doc pack

| Item | Status | Evidence | Gap |
|---|---|---|---|
| `docs/decisions.md` | Met | D-01 to D-27 with status and evidence; C-01 to C-24 with brief impact | - |
| `docs/requirements.md` | Met | Brief rows, matrix cells M1-M6, D-01 to D-27, follow-ups X1 and X2 | - |
| `docs/architecture.md` + `architecture/` | Met | Index plus as-built `hla.md`, `lla.md`, `sequences.md` synced to commit 1e3f900 (the last code change): Test Runs path and API, tabs, run conditions, getStats playback stats, a Test Run sequence diagram; every Mermaid block balanced | Diagrams checked structurally, not rendered |
| `docs/measurement-protocol.md` | Met | Sections 1-7 unchanged; section 8 as implemented, including live voice, human spot-check and run conditions | - |
| `docs/build-plan.md` | Partial | Plan vs actual, commits per milestone, hours per round (about 7.9 h recorded) | Control-room estimates and planned commits never existed (D-27); planning hours unrecorded |
| `CLAUDE.md` | Met | Standing rules 1-10; agent log current | - |
| `docs/status.md` | Met | End-of-round snapshot: metrics, closed gaps, open items, no WIP | - |
| `README.md` | Met | Setup, run, architecture, language rationale, git history guide, Test Runs | - |
| `docs/comparison.md` | Met | Matrix cells, stability, disclosures including push-to-talk and release lag | - |
| `docs/agent-log/` | Partial | `00` planning, `01` initial-build prompts, `02` conformance prompts, `03` and `04` plans written before the work with results | Per-milestone M0-M7 prompts never existed (one build phase from the pack) |
| Style: no em dashes or double hyphens | Justified | Swept | The source brief and verbatim prompts keep their text |
| Guardrail: locked-decision changes routed to the owner | Justified | C-01 and C-03 logged after the fact; every later change (C-12, C-22 to C-24) was requested or confirmed by the owner first | - |

## (c) Planning decisions

Full status and evidence: [`decisions.md`](decisions.md).

| Item | Status | Evidence | Gap |
|---|---|---|---|
| D-01 Brief governs PRD | Met | README; conflicts in D-01 | - |
| D-02 Stack | Met | `server/Workbench.sln`, `client/`, contract tests | - |
| D-03 Local only | Met | `npm run dev`; Railway deployment considered and declined by the owner | - |
| D-04 One process, two modules | Met | `architecture/hla.md` | - |
| D-05 Realtime WebRTC, minted secret | Met | `RealtimeSessionEndpointTests`, `realtime.spec.ts` | - |
| D-06 Cascade on backend, PCM16 WS | Met | `CascadeSocketTests` | - |
| D-07 One transport, one schema | Justified | Extended (C-02), no separate session machine (C-19), playback stats callback | - |
| D-08 Providers behind interfaces | Met | Contract and factory tests; failover scope C-17 | - |
| D-09 Two push-to-talk buttons | Met | `audio-engine.spec.ts`; disclosed in comparison | - |
| D-10 Consecutive playback | Met | pipeline test; disclosed | - |
| D-11 Floor deny | Justified | Widened to Capturing (C-01) | Not routed to the owner at the time |
| D-12 Queued mode switch | Justified | Switch tests; also from Warming and some Error states (C-16) | - |
| D-13 Commit policies | Met | `CommitPolicyTests`, report | - |
| D-14 Acoustic T0 | Met | EnergyDetector tests; live session confirms release lag 0.15 s vs harness 0.41 s | - |
| D-15 Metrics | Partial | `metrics.ts`, report, soak, getStats playback health | Realtime buffer depth over time not observable; server memory not sampled |
| D-16 Realtime stages hidden | Met | `ModeComparison.tsx`, report | - |
| D-17 Quality definition | Met | WER, rubric, heuristic tests; blind human spot-check | - |
| D-18 Fair comparison | Met | Replay harness; run conditions with `runId` and build (C-09 resolved for new runs) | Older runs show an inferred build |
| D-19 Cost from usage x prices | Partial | `turnCost` tests, verified prices | DeepL price unverified |
| D-20 Warm-up, press-to-warm | Met | Warming test, `StartTurnAsync` | - |
| D-21 Deny tone never first audible | Met | `denyTone.test.ts`, e2e | - |
| D-22 Secrets in `.env` | Met | `HealthEndpointTests`, `.gitignore`, deny rules | - |
| D-23 Scope filter | Met | Every addition traced in `requirements.md` and `decisions.md` (C-12, C-22 to C-24) | - |
| D-24 Synthetic clips | Partial | Clips cached and disclosed; live English session | Spanish to English never tested live |
| D-25 DeepL swap and onboarding runs | Met | report §4, onboarding.md | - |
| D-26 UI follows the design | Justified | Changed with the owner: Compare modes row (C-22), tabs (C-23, C-24); e2e for error states and layout | - |
| D-27 Build phase, then owner-directed rounds | Met | KICKOFF.md, PROGRESS.md, build-plan.md | - |

## Remaining gaps (product or owner decisions only)

| Gap | Type |
|---|---|
| DeepL API price unverified (D-19, impact) | Owner / research |
| Heap floor growth over long sessions; server memory not sampled (P3, D-15) | Product (a no-cost long soak is the next step) |
| Realtime jitter-buffer depth over time (D-15) | Platform limit, disclosed |
| Spanish to English never tested with a live speaker (D-24) | Owner |
| Glossary tested only on the clips it was written for | Product |
| Control-room estimates and per-milestone prompts never existed (build-plan, agent-log) | Process, required from now on and followed in rounds 03 and 04 |
| Merge requests to review and merge | Owner |

Doc gaps found in this pass and fixed: the as-built architecture docs
described an older commit; status, hours and logs were behind the work.

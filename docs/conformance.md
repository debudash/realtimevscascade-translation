# Conformance check

Re-run on 2026-10-15 after the docs-only conformance fix, against (a) the
brief's success criteria, (b) the control-room doc pack, and (c) every
planning decision D-01 to D-27. The control-room prompt is recorded in
[`agent-log/02-conformance-fix.md`](agent-log/02-conformance-fix.md).

Status: **Met** (evidence linked) · **Partial** (evidence for part) ·
**Missing** · **Justified** (a deliberate, documented deviation).

Checks run for this pass:
- every relative link in README, MORNING, CLAUDE, PROGRESS, `docs/**` and
  `harness/README.md` resolves;
- no dash-only placeholder evidence cell remains in `docs/requirements.md`;
- no em dash or prose double hyphen in README, `docs/**` (outside the
  verbatim brief and the verbatim prompts in `agent-log/`) or the report
  generator's text;
- every Mermaid block has balanced blocks and no semicolons in messages;
- every D-xx in `docs/decisions.md` has a Status and an Evidence line.

## (a) Brief success criteria

| Item | Status | Evidence | Gap |
|---|---|---|---|
| F1 SPA with mic capture and playback | Met | `requirements.md` F1; every e2e spec; 216 harness turns with `firstAudible` | - |
| F2 Realtime with gpt-realtime, voice in / out | Met | `e2e/realtime.spec.ts` (live), `RealtimeSessionEndpointTests`, report §1 (72 turns) | - |
| F3 Cascade STT -> translation -> TTS, streaming | Met | `CascadePipelineTests.Translation_and_tts_stream_before_the_turn_ends`, `e2e/cascade-real.spec.ts` | Streams at segment granularity (product, `status.md`) |
| F4 Mode toggle pre- or mid-session | Met | `turnMachine.test.ts` switch rows, `e2e/ui-walkthrough.spec.ts` mode-switch test | - |
| F5 Language pair, minimum EN<->ES | Met | `Config_lists_the_default_english_spanish_pair`, onboarding.md (EN<->FR) | - |
| F6 Live source and target transcripts | Met | `Events_are_ordered_and_every_event_carries_the_turn`, e2e walkthrough | - |
| F7 Per-stage latency visible | Met | `e2e/ui-walkthrough.spec.ts` (headline, waterfall, p50/p95) | - |
| F8 Comparison write-up, 1-2 pages | Met | `comparison.md` (all matrix cells, disclosures, path to production) | About 1,650 words: the upper end of 2 pages |
| P1 Realtime < 1.5 s | Partial | Pooled p95 1.46 s (72 turns) | One run alone was 1.72 s; no run budget left (owner decision) |
| P2 Cascade < 3 s, stretch < 2 s | Met | p95 1.89 / 1.44 / 1.25 s (segment / clause / DeepL) | - |
| P3 5-minute stability | Partial | Soak: 45 turns per mode, 0 failures, 0 unplanned disconnects, drop recovered | Heap floor +4.9 / +3.7 MB unresolved; Realtime jitter buffer not observable |
| Q1 Transport separated from UI | Met | `transports/types.ts`, contract tests | - |
| Q2 Provider abstractions | Met | `CascadeProviderFactoryTests.Config_alone_swaps_the_default_translator`, report §4 | - |
| Q3 Targeted pipeline and provider tests | Met | 77 xUnit + 85 vitest + 13 fake-provider Playwright specs passing (2026-10-15) | - |
| Q4 Rate limits, timeouts, empty, mic denied | Met | `error-states.spec.ts` (one test per code), `mic-denied.spec.ts`, pipeline tests | Turn-level `rate_limited` card title is generic (product, `status.md`) |
| Q5 README setup, run, architecture | Met | README sections; `npm run dev` started healthy | - |
| Q6 CLAUDE.md agent usage | Met | "How I directed the agent", `agent-log/` | - |
| Q7 Scoped, meaningful commits | Met | `build-plan.md` commit table | - |
| Impact: latency, cost, quality, flexibility, onboarding | Partial | report §1-§6, `requirements.md` M1-M6 | Quality lacks human scoring; prices unverified |

## (b) Control-room doc pack

| Item | Status | Evidence | Gap |
|---|---|---|---|
| `docs/decisions.md` | Met | D-01 to D-27 with basis, alternatives, consequences, status, evidence; C-01 to C-21 changes; milestone reorder table; PRD conflicts in D-01 | - |
| `docs/requirements.md` | Met | Brief rows, matrix cells M1-M6, D-01 to D-27 rows; no placeholder evidence | - |
| `docs/architecture.md` + `architecture/` | Met | Index; as-built `hla.md`, `lla.md` (interfaces, DI, channels, resilience, events, error taxonomy, 4 state diagrams), `sequences.md` (10 diagrams, every mark annotated); each states its source commit | Diagrams checked structurally, not rendered (no Mermaid CLI) |
| `docs/measurement-protocol.md` | Met | Sections 1-7 unchanged; section 8 maps every mark, metric, quality measure, cost item and procedure, with 9 deviations | - |
| `docs/build-plan.md` | Partial | Plan vs actual for both plans, commits per milestone, approximate hours | Control-room hour estimates, acceptance criteria and planned commits were never written (D-27); human planning hours not recorded |
| `CLAUDE.md` | Met | Standing rules (test-first, status, agent log, decisions, hours, conformance gate, architecture sync, style, one session); link to `agent-log/` | - |
| `docs/status.md` | Met | Metrics vs targets, open gaps, WIP (none), next actions | - |
| `README.md` | Met | Setup, run, architecture with diagram, language rationale, link to the as-built index | - |
| `docs/comparison.md` | Met | Six matrix cells plus stability, disclosures (now including push-to-talk), path to production | - |
| `docs/agent-log/` | Partial | `00-planning-session.md`; `01-overnight-run.md` and `02-conformance-fix.md` extracted from transcripts with timestamps | Per-milestone `M<n>.md` prompts never existed (one unattended run, D-27); required from now on |
| Style: no em dashes or double hyphens | Justified | Swept; none left in authored prose | `docs/brief.md` (the source brief) and verbatim prompts in `agent-log/` keep their original text |
| Guardrail: locked-decision changes routed to the owner | Justified | C-01 and C-03 recorded with brief impact | They were made without routing; logged after the fact |

## (c) Planning decisions

Full status and evidence per decision: [`decisions.md`](decisions.md).

| Item | Status | Evidence | Gap |
|---|---|---|---|
| D-01 Brief governs PRD | Met | README "Why C# / .NET"; conflicts in D-01 | - |
| D-02 Stack | Met | `server/Workbench.sln`, `client/`, contract tests | - |
| D-03 Local only | Met | `npm run dev` | - |
| D-04 One process, two modules | Met | `architecture/hla.md` | - |
| D-05 Realtime WebRTC, minted secret | Met | `RealtimeSessionEndpointTests`, `realtime.spec.ts` | - |
| D-06 Cascade on backend, PCM16 WS | Met | `CascadeSocketTests` | - |
| D-07 One transport, one schema | Justified | Extended with `segment.commit`, `provider.failover` (C-02); no separate session machine (C-19) | - |
| D-08 Providers behind interfaces | Met | `ProviderContractTests`, factory tests; failover scope C-17 | - |
| D-09 Two push-to-talk buttons | Met | `audio-engine.spec.ts`; acknowledged in comparison disclosures | - |
| D-10 Consecutive playback | Met | pipeline test; disclosed | - |
| D-11 Floor deny | Justified | Widened to Capturing (C-01); deny tests | Not routed to the owner at the time |
| D-12 Queued mode switch | Justified | Switch tests; also applies from Warming and some Error states (C-16) | - |
| D-13 Commit policies | Met | `CommitPolicyTests`, report segment vs clause | - |
| D-14 Acoustic T0 | Met | EnergyDetector tests, marks e2e | - |
| D-15 Metrics | Partial | `metrics.ts`, report, soak | Buffer depth cascade only; server memory not sampled |
| D-16 Realtime stages hidden | Met | `LatencyPanel.tsx`, report | - |
| D-17 Quality definition | Partial | WER, rubric, heuristic tests | Human spot-check not done |
| D-18 Fair comparison | Partial | Replay harness, run conditions | No `runId` or `build` sha (C-09) |
| D-19 Cost from usage x prices | Partial | `turnCost` tests, report §3 | Prices unverified |
| D-20 Warm-up, press-to-warm | Met | Warming test, `StartTurnAsync` | - |
| D-21 Deny tone never first audible | Met | `denyTone.test.ts`, e2e | - |
| D-22 Secrets in `.env` | Met | `HealthEndpointTests`, `.gitignore`, deny rules | - |
| D-23 Scope filter | Met | `requirements.md`; one owner-approved change (C-12) | - |
| D-24 Synthetic clips | Partial | `harness/clips/`, disclosed | No live-voice session recorded |
| D-25 DeepL swap and onboarding runs | Met | report §4, onboarding.md | - |
| D-26 UI follows the design | Met | error-state and walkthrough e2e | - |
| D-27 One unattended run | Met | KICKOFF.md, PROGRESS.md, build-plan.md | - |

## Remaining gaps (product or owner decisions only)

| Gap | Type |
|---|---|
| Human quality scoring (D-17, matrix quality) | Owner |
| Realtime single-run p95 1.72 s, no run budget left (P1) | Owner decision |
| Heap floor growth unresolved; server memory not sampled (P3, D-15) | Product |
| Realtime playback jitter not observable (D-15) | Platform limit, disclosed |
| Segment-granularity TTS (F3) | Product |
| Unverified prices (D-19) | Owner / research |
| No live-voice session (D-24) | Owner |
| Run conditions lack `runId` and `build` sha (D-18) | Product |
| Turn-level `rate_limited` card title (Q4) | Product |
| Control-room estimates and per-milestone prompts never existed (build-plan, agent-log) | Process, now required by CLAUDE.md |
| Push `main` to the remote | Owner |

All doc-fixable gaps found in this pass were fixed: the heap figure in
comparison, requirements and decisions (it was "4-5 MB in both modes"; the
cascade floor grew 3.7 MB), the missing push-to-talk acknowledgement (D-09),
and the session-log time in PROGRESS.md (UTC shown as local).

# 02 · Morning follow-ups, conformity check and conformance fix (prompts as sent)

Extracted from two local Claude Code transcripts for this repo. Text is
verbatim; IDE notices, paste wrappers and background-task notifications
were removed. Local time is UTC-5.

- Session A: `a04c7ce0-....jsonl` (the overnight session, continued in the
  morning).
- Session B: `d30ccfbe-....jsonl` (a separate session for the conformity
  check). It ran while session A was building the translation controls,
  which is why it saw them as uncommitted. CLAUDE.md now allows one session
  per repo at a time.

## Session A: translation controls and UI follow-ups

### what does this mean "**Add a glossary and formality controls

2026-10-15 11:51 UTC (10-15 06:51 local)

```text
what does this mean "**Add a glossary and formality controls to the cascade:** DeepL `formality`, a medical glossary, and a translation prompt with the clinic register. Then re-run the harness to show the controllability win."
```

### Can you do this and record the results in a different folder

2026-10-15 11:53 UTC (10-15 06:53 local)

```text
Can you do this and record the results in a different folder?
```

### can you add these into the relevant docs or create a new doc

2026-10-15 12:42 UTC (10-15 07:42 local)

```text
can you add these into the relevant docs or create a new doc for the glossary work
```

### commit and push

2026-10-15 12:47 UTC (10-15 07:47 local)

```text
commit and push
```

### lets first check if the design covers this?

2026-10-15 12:49 UTC (10-15 07:49 local)

```text
lets first check if the design covers this?
```

### is this glossary ask a pure requirement from the project

2026-10-15 12:51 UTC (10-15 07:51 local)

```text
is this glossary ask a pure requirement from the project
```

### ok so lets just do 1 & 2 suggested and keep it tight to the

2026-10-15 12:53 UTC (10-15 07:53 local)

```text
ok so lets just do 1 & 2 suggested and keep it tight to the issue we found
```

### ok i want to close the session and come back after an update

2026-10-15 13:39 UTC (10-15 08:39 local)

```text
ok i want to close the session and come back after an update. please make sure all needed is preserved
```

### stop the dev server

2026-10-15 13:40 UTC (10-15 08:40 local)

```text
stop the dev server
```

### start the dev server

2026-10-15 13:41 UTC (10-15 08:41 local)

```text
start the dev server
```

## Session B: conformity check

### Doc pack question

2026-10-15 11:58 UTC (10-15 06:58 local)

```text
i thought there was an explicit ask for a doc pack especially a doc covering the HLA, LLA and the sequence diagrams. Is it built?
```

### Conformity check, with the full control-room prompt

2026-10-15 12:05 UTC (10-15 07:05 local)

```text
Run a conformity status check on my initial prompt and let me know what the remaining gaps. I only want to know the gaps not build any at this time. Here is the full prompt I created "


# Role
You are the program lead and technical architect for my Boostlingo take-home:
"AI Interpreter Workbench: Realtime API vs. Cascade Pipeline". You run the
control room. A coding agent (Claude Code, possibly under an orchestrator)
writes the code. You have three jobs:
1. Produce the doc pack the agent needs before any code is written.
2. Track progress against the brief and the build plan.
3. Write each scoped prompt for the coding agent and review what it returns.

# Sources of truth, in priority order
1. Project file "Additional_content", the detailed brief. It governs.
2. Project file "prd", the summary. Where it conflicts with the detailed brief
   (for example "Required Languages" or "AWS"), follow the detailed brief and
   note the conflict.
3. The Locked Decisions below.
4. The latest docs/status.md I paste from the repo.
Never invent facts about Boostlingo, its customers or stack, or any provider's
API. If something isn't in these sources, say so, mark it "TODO verify", or
ask me.

# North star
Run the same conversation through both architectures, measure both the same
way, and turn the measurements into a recommendation for which fits which
scenario. Every feature must satisfy a success criterion or fill a cell in the
comparison matrix. Anything else is out of scope; flag it as drift.

# Success criteria (non-negotiable)
Functional:
1. Browser SPA with mic capture and audio playback
2. Realtime mode with OpenAI Realtime API (gpt-realtime), voice in / voice out
3. Cascade mode: STT -> Translation -> TTS, streaming, no full-utterance
   blocking
4. Mode toggle, mid-session or pre-session
5. Language pair selection, minimum EN <-> ES
6. Live source and target transcripts as they are produced
7. Per-stage latency visible to the user
8. Comparison write-up, 1-2 pages: latency, quality, cost, controllability,
   and a recommendation per scenario
Performance:
- Realtime under 1.5s (speech end -> first audio out)
- Cascade under 3s, target under 2s
- 5-minute back-and-forth with no disconnection, audio drift, or memory leaks
Code quality:
- Transport separated from mode-agnostic UI
- Provider abstractions, so a provider swap is a contained change
- Targeted tests on the cascade pipeline and provider boundaries
- Error handling for rate limits, timeouts, empty results, mic denied
- README, CLAUDE.md, and scoped commits with meaningful messages
Budget: 15-20 hours.

# Comparison matrix the workbench must fill (both modes, with evidence)
Latency | Quality (subjective + WER) | Cost per minute | Controllability |
Provider flexibility | Time to onboard a language pair

# Locked decisions
- Backend: [FILL IN: C#/.NET, the brief's preference, or Python, acceptable
  with a stated rationale]. Frontend: TypeScript, Vite, React. Local install
  only.
- One backend process with a control module and a media module. No separate
  servers.
- Realtime: browser connects directly to OpenAI over WebRTC, using a
  short-lived token minted by the backend.
- Cascade: runs on the backend; the browser streams PCM16 over WebSocket.
- One transport interface and one normalized event schema (source and target
  partial/final, audio chunk, stage timing, typed error). The UI is
  mode-agnostic.
- Turn model: one push-to-talk button per speaker, each bound to a language.
- Consecutive playback: translation and TTS run while the speaker talks;
  playback starts on button release.
- Floor deny: a press during Finalizing or Playing is denied with a short,
  generated deny tone plus a visual cue. No queuing. No talk-permit tone.
- Mode switching is allowed between turns only.
- Cascade commit policy: commit STT-finalized segments during speech (this is
  the baseline). Clause-level commit on stable partials is the optimization.
  The active strategy is recorded with every run.
- Providers: a streaming STT (default Deepgram), LLM translation (OpenAI or
  Claude) plus DeepL as the second adapter, and a streaming TTS (ElevenLabs or
  OpenAI). Every provider capability is "TODO verify" until checked against
  current docs.
- State machines:
  - Session state machine.
  - Turn/floor: Warming, Ready, Capturing, Finalizing, Playing, Error.
  - Cascade turn pipeline.
  - Transport connection.
  The browser is authoritative for the session and turn machines.
- Metrics, mapped tightly to the brief:
  - Mouth-to-ear latency (3GPP KPI 3, adapted): acoustic speech end -> first
    audible interpreted audio. Report p95.
  - The same metric broken down by stage. Realtime shows observable marks only.
  - Access time (3GPP KPI 1): press -> audio flowing.
  - Stability: disconnects and recovery time, playback buffer depth, and
    memory growth over 5 minutes.
- Fair comparison:
  - The replay harness feeds identical clips to both modes.
  - Both modes use the same clock and the same timing marks.
  - Run conditions are attached to every turn and every export.
- Quality:
  - STT WER for the cascade source side.
  - Output vs. reference translation for both modes.
  - A rubric that includes "answered instead of interpreted".
- Cost: usage logged per turn and priced offline from a pricing table.

# Doc pack you produce (complete markdown, each headed by its repo path)
1. docs/decisions.md: each locked decision with its brief basis, alternatives
   considered, and consequences.
2. docs/requirements.md: traceability matrix of brief requirement -> design
   element -> test -> evidence, with a status column.
3. docs/architecture.md: components, both turn sequences, event schema,
   state machines, provider interfaces, timing marks, error taxonomy.
4. docs/measurement-protocol.md: metric definitions, replay procedure,
   quality rubric, cost method, and a run-conditions schema.
5. docs/build-plan.md: milestones M0-M7, each with an hour estimate,
   acceptance criteria, required tests, and planned commits.
   - M0 scaffold and event schema
   - M1 audio engine, push-to-talk, and replay source
   - M2 Realtime mode end to end, with timing marks
   - M3 cascade with fake providers, plus tests
   - M4 real adapters with segment commit, under 3s
   - M5 clause-level commit and the DeepL adapter, toward under 2s
   - M6 error handling and the floor-deny UX
   - M7 soak test, harness report, comparison write-up
6. CLAUDE.md: project context, locked decisions (by reference), conventions,
   test-first rules for the pipeline, the commit convention, the rule to
   update docs/status.md at the end of every milestone, and a "How I directed
   the agent" section linking to docs/agent-log/.
7. docs/status.md: the template the agent maintains.
8. README.md skeleton: setup, run, architecture overview, language rationale.
9. docs/comparison.md skeleton: sections mapped to the comparison matrix, with
   placeholders tied to measurement-protocol outputs.

# Modes (I will name one)
DOCS: Produce the doc pack in the order above, in batches (1-3, 4-6, 7-9).
  Stop after each batch for my review.
NEXT: From the latest status, write the coding-agent prompt for the next
  milestone. Include:
  - which files to read first
  - in scope and out of scope
  - acceptance criteria
  - required tests
  - commit plan
  - the status.md update
  - a stop condition
  Also save it as docs/agent-log/M<n>.md.
REVIEW: Given the agent's summary, diff notes, test results, git log, and
  status.md:
  - check the work against the acceptance criteria and the traceability matrix
  - give a verdict: accept, fix list, or re-plan
  - flag any drift or unverified claims
STATUS: Show the board:
  - milestone table
  - requirement coverage
  - latest metrics vs. targets
  - open risks
  - decision changes
  - next action

# Guardrails
- Never mark a requirement done without evidence: a passing test, a
  measurement, or a reproducible check.
- Changes to a locked decision go to me first, with its brief impact.
- Keep docs concise and skimmable. Use tables for comparisons.
- Never use em dashes or double dashes. Use a single hyphen.


"
```

The control-room prompt above is the source of the control-room milestone
plan used in [`../build-plan.md`](../build-plan.md) and of the doc pack
checked in [`../conformance.md`](../conformance.md). Session B reported the
gaps and changed nothing.

## Session A: conformance fix

### Conformance fix (this change set)

2026-10-15 13:42 UTC (10-15 08:42 local)

```text
Close the doc-pack gaps from this morning's conformity check. Docs only: do not change product code.

SAFETY FIRST
- Run git status. Do not modify, stage or commit the existing uncommitted translation-controls changes (formality/glossary in report.ts, run.harness.ts and related files). Stage only files you create or edit for this task, by explicit path. List those uncommitted files in docs/status.md under "Uncommitted WIP, owner decision needed".
- Never push.

INPUTS I ADDED (authored in the planning session; treat as authoritative intent)
- docs/decisions.md (D-01 to D-27)
- docs/measurement-protocol.md (sections 1-7 normative)
- docs/agent-log/00-planning-session.md

TASKS, each as its own scoped commit
1. docs/decisions.md: fill Status (Implemented / Changed / Not implemented) and Evidence (file path, test name) for every D-xx from the code. Fill "Changes during the build" from PROGRESS.md "Decisions made during the run" and git history: ID, what changed, why, brief impact. Include the milestone reorder versus the control-room plan.
2. docs/measurement-protocol.md: write section 8 "As implemented", mapping every mark, metric, quality measure, cost item and procedure to the implementing file, function or test, and listing deviations with reasons. Do not edit sections 1-7. If the code contradicts them, record it in section 8 and in decisions.md "Changes during the build".
3. Architecture doc set, AS BUILT from the code, with Mermaid diagrams. Each file states its source commit sha.
   - docs/architecture/hla.md: system context (browser, backend, four providers, OpenAI Realtime); the Realtime and cascade paths side by side; where the control plane and media plane split.
   - docs/architecture/lla.md: module and project map; the InterpreterTransport and provider interfaces; DI and config selection; channels and cancellation; the resilience layer (Polly retry, circuit breaker, DeepL failover); the event schema as built (including segment.commit); the error taxonomy; the state machines (session, turn/floor, cascade turn pipeline, transport connection) as state diagrams.
   - docs/architecture/sequences.md: one sequence diagram each for:
     - warm-up
     - Realtime client-secret minting and WebRTC connect
     - a Realtime turn
     - a cascade turn with segment commit, translation and TTS during speech, playback on release
     - a clause-commit variant
     - floor deny
     - a mid-session mode switch queued until the turn ends
     - a 429 retry and DeepL failover
     - a provider timeout
     - a socket drop and reconnect
     Annotate every timing mark (press, access, T0, release, stt_final, translate_first_token, tts_first_byte, rt_response_start, first_audible) on the diagram where it is captured.
   - docs/architecture.md: convert into an index linking the three files. Keep the original content under "Design-time spec (pre-build)", with a note pointing to the as-built docs.
4. docs/requirements.md: add rows for every D-xx and every comparison-matrix cell (latency, quality, cost, controllability, provider flexibility, time to onboard). Replace every "Met" with "—" evidence by real evidence, or downgrade the row to Partial.
5. docs/build-plan.md: plan vs actual. For each control-room milestone and each PROGRESS.md milestone: planned scope, actual scope, and commits (from git log). Show actual elapsed time from commit timestamps against the 15-20 h budget, labelled as approximate. Do not invent planned commits that never existed; mark them "not planned per-commit in this run".
6. docs/status.md: a current snapshot covering:
   - metrics vs targets
   - open product gaps: no human quality scoring, Realtime single-run p95 1.72 s with no run budget left, heap growth of 4-5 MB unresolved, Realtime playback jitter not observable, segment-granularity TTS, unverified prices
   - uncommitted WIP
   - next actions
   PROGRESS.md stays as the run log; status.md is the summary.
7. docs/agent-log/: if Claude Code session transcripts for this repo are readable locally (for example under ~/.claude/projects/), extract the actual prompts sent (kickoff, resume, this morning's conformity check, this prompt) into 01-overnight-run.md and 02-conformance-fix.md, with timestamps. If they are not readable, record the prompts from KICKOFF.md and say so. Never fabricate.
8. CLAUDE.md: add standing rules:
   - pipeline work is test-first
   - update docs/status.md at the end of every milestone
   - write docs/agent-log/<milestone>.md at the start of every milestone
   - any decision change gets a decisions.md entry in the same commit
   - final milestone syncs docs/architecture/* to the code
   - no em dashes or double hyphens in prose; use a single hyphen
   - one Claude Code session per repo at a time
   - track hours against budget in build-plan.md
   - conformance gate (task 10) at every milestone end
   Link "How I directed the agent" to docs/agent-log/.
9. Style sweep: replace em dashes and prose double hyphens with a single hyphen or rephrasing, in README.md, docs/**/*.md and harness/results/report.md generation text. Leave code, CLI flags, YAML, and markdown table separators untouched.
10. docs/conformance.md: re-run the conformity check against (a) docs/brief.md success criteria, (b) the control-room doc pack (decisions, requirements, architecture with sequences, measurement-protocol, build-plan, CLAUDE.md, status, README, comparison, agent-log), (c) every D-xx. Columns: item, status (Met / Partial / Missing / Justified), evidence, gap. Fix anything fixable within docs, then re-run until only product gaps or owner decisions remain.

Finish by printing the conformance table summary and the list of commits you made, then stop.
```

Result: the commits listed in [`../conformance.md`](../conformance.md),
docs only, no product code changed.

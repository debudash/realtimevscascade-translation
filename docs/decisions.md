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
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

### D-03 · Local install only
- **Basis:** "Local-only with clear setup instructions is fine."
- **Alternatives:** AWS (S3 + CloudFront for the SPA, ECS Fargate behind an
  ALB for the backend).
- **Consequences:** no deployment work. `getUserMedia` works on localhost
  without HTTPS. Demo on one machine only.
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

### D-06 · Cascade runs on the backend; the browser streams PCM16 over WebSocket
- **Basis:** the provider-abstraction and per-stage instrumentation
  requirements.
- **Alternatives:** run the cascade in the browser (exposes provider keys,
  weaker resilience).
- **Consequences:** keys, retries, and stage timing all live in one process.
- **Status:** | **Evidence:**

### D-07 · One transport interface and one normalized event schema
- **Decision:** the UI is mode-agnostic. Events: `source.*`, `target.*`,
  `audio.chunk`, `stage.timing`, typed `error`. Every event carries `turnId`.
- **Basis:** the code quality expectation of transport/UI separation;
  criterion 4 (mode toggle).
- **Consequences:** a mode switch closes one transport and opens the other;
  the transcript store persists.
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

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
- **Status:** Changed in planning (scope widened) | **Evidence:**

### D-12 · Mode switching is queued until the turn ends
- **Basis:** criterion 4: "mid-session or pre-session."
- **Alternatives:** "Cancel turn and switch now" (it was in the original
  design and was removed).
- **Consequences:** no mid-turn teardown. The pending-switch banner offers
  "Stay on {current}".
- **Status:** | **Evidence:**

### D-13 · Cascade commit policy: `segment` baseline, `clause` optimization
- **Decision:** commit each STT-finalized segment *during* speech (baseline).
  Commit at clause boundaries within stable partials (optimization). The
  policy is a pure function, selectable, and recorded on every run.
- **Basis:** "Streaming throughout the cascade pipeline (no full-utterance
  blocking)"; the cascade target of under 3s, stretch under 2s.
- **Alternatives:** commit on endpoint (end of utterance). Rejected, because
  with push-to-talk it means full-utterance blocking.
- **Consequences:** the commit policy is the main experimental variable.
- **Status:** | **Evidence:**

### D-14 · T0 is acoustic speech end, not button release
- **Basis:** "speech end → first audio out."
- **Alternatives:** release as T0. Rejected: it understates latency by the
  time a speaker keeps holding the button after they stop talking.
- **Consequences:** a client-side energy detector. Release is recorded as a
  separate mark, and the release lag is visible.
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

### D-16 · Realtime internal stages are shown as "hidden," never estimated
- **Basis:** criterion 7 and the controllability dimension.
- **Consequences:** this asymmetry is itself a controllability finding.
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

### D-18 · Fair comparison: identical input, identical clock, recorded run conditions
- **Decision:**
  - The replay harness feeds the same clips to both modes.
  - Both modes use one browser clock and the same marks.
  - Every turn and every export records its run conditions.
- **Basis:** the purpose of the brief: a defensible comparison.
- **Status:** | **Evidence:**

### D-19 · Cost per minute from logged usage times a dated pricing table
- **Basis:** the "cost per minute" impact metric.
- **Alternatives:** a live cost meter in the UI (cut: not a must-have).
- **Status:** | **Evidence:**

### D-20 · Warm-up and press-to-warm
- **Decision:** connections and providers are warmed on page load and after
  a mode switch. The STT stream opens on press.
- **Basis:** keeps cold starts out of the first turn and out of p95.
- **Status:** | **Evidence:**

### D-21 · The deny tone never counts as first audible
- **Basis:** measurement integrity. An earcon must not shorten "first audio
  out."
- **Status:** | **Evidence:**

### D-22 · Secrets in a gitignored `.env` that the agent is denied from reading
- **Decision:** the backend loads `.env` via DotNetEnv, and real environment
  variables take precedence.
- **Alternatives:** system environment variables via `setx` (the first
  pack); `dotnet user-secrets` (needs the project to exist first).
- **Status:** | **Evidence:**

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
- **Status:** | **Evidence:**

### D-24 · Synthetic speech clips for evaluation
- **Decision:** TTS-generated EN and ES clinic sentences with reference
  transcripts and translations, generated once and cached.
- **Consequences:** synthetic speech is cleaner than human speech. Disclose
  this, and complement it with a live-voice session.
- **Status:** | **Evidence:**

### D-25 · Evidence runs for flexibility and onboarding
- **Decision:**
  - A cascade run with DeepL as the primary translator (a config-only
    change).
  - An EN↔FR onboarding exercise that records the files touched and the
    effort per architecture.
- **Basis:** the impact metrics "provider flexibility" and "time to onboard
  a new language pair."
- **Status:** | **Evidence:**

### D-26 · UI follows the approved design
- **Decision:**
  - Boostlingo logo plus a "not an official Boostlingo product" disclaimer.
  - Three-column layout.
  - Waterfall labelled "final segment from T0."
  - p50/p95 table colored against targets.
  - Export button.
  - One state per error code.
- **Basis:** criteria 5, 6, 7; error-handling expectations.
- **Status:** | **Evidence:**

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
- **Status:** Implemented | **Evidence:** KICKOFF.md, PROGRESS.md

---

## Changes during the build
(Filled from PROGRESS.md "Decisions made during the run" and git history:
ID, what changed, why, brief impact.)

- **D-23 change · Clinic terms toggle (after the build, at the user's request).**
  The evaluation found two clinic errors (informal *tú*, "receta" →
  *recipe*), fixed by the translation controls
  ([translation-controls.md](translation-controls.md)). A header On/Off toggle
  and a per-turn "Clinic terms on" / "Clinic terms off" tag make that fix
  visible and demonstrable. Still out of scope: glossary editing in the UI
  and highlighting glossary terms in transcripts. Evidence:
  `client/src/ui/Header.tsx`, `client/src/ui/Transcripts.tsx`,
  `e2e/ui-walkthrough.spec.ts`.

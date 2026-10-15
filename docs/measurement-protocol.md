# Measurement protocol

This protocol defines how both architectures are measured so the comparison
is fair and reproducible. Sections 1-7 are normative: they were defined
during planning (see `docs/decisions.md` D-14 to D-19, D-21, D-24, D-25).
Section 8 maps each item to the code and harness as built.

## 1. Principles
- **Identical input:** both modes receive the same replay clips through the
  same browser capture path.
- **One clock:** perceived latency is measured on the browser clock
  (`performance.now()`). The server reports stage *durations* only
  (Stopwatch), never wall-clock timestamps.
- **Distributions, not anecdotes:** report p50 and p95 per mode and strategy.
  Never report single runs.
- **Observable only:** Realtime internal stages are shown as "hidden."
  Nothing is estimated.
- **Run conditions travel with every number** (section 6).

## 2. Timing marks (per turn)

| Mark | Definition | Captured where |
|---|---|---|
| `press` | Talk button pointerdown or keydown | Browser |
| `access` | First audio frame accepted by the transport: cascade WebSocket send; Realtime track live | Browser |
| `T0` | Acoustic speech end: the last voiced frame from the client energy detector | Browser |
| `release` | Talk button pointerup or keyup; the playback trigger | Browser |
| `stt_final` | Final segment's STT final (cascade) | Server duration, mapped on receipt |
| `translate_first_token` / `translate_done` | Final segment translation (cascade) | Server duration |
| `tts_first_byte` | Final segment TTS first audio (cascade) | Server duration |
| `rt_response_start` | Realtime response start event | Browser, data channel |
| `first_audible` | First audible *interpreted* audio | Browser: playback tap (cascade); AnalyserNode on the remote track (Realtime) |

**Exclusion rule:** the floor-deny tone bypasses the playback tap and can
never produce `first_audible`.

## 3. Metrics

| Metric | Formula | Standards term | Target |
|---|---|---|---|
| Mouth-to-ear latency (headline) | `first_audible - T0` | 3GPP KPI 3, adapted to consecutive interpretation | Realtime < 1.5 s; cascade < 3.0 s (stretch < 2.0 s), at p95 |
| Stage breakdown | Differences between consecutive marks | Per-stage view of KPI 3 | The stages must account for the headline value |
| Access time | `access - press` | 3GPP KPI 1 | No brief target; MCPTT reference is 300 ms at p95 |
| Release lag | `release - T0` | None | Reported for transparency |
| Disconnects | Count per session | None | 0 over 5 minutes |
| Recovery time | Forced drop → Ready, transcript intact | None | Report |
| Playback buffer depth | Buffered ms, sampled over the session | Audio drift indicator | Bounded, with no upward trend |
| Memory growth | Browser heap and server memory, start vs. end | Leak indicator | No sustained growth |

## 4. Quality

| Measure | Applies to | Method | Label |
|---|---|---|---|
| Source WER | Cascade | Word-level Levenshtein vs. the reference transcript | WER |
| Target WER | Both modes | vs. the reference translation | "Crude proxy: many valid translations exist" |
| Rubric: accuracy, completeness, fluency (1-5) | Both modes | Automated LLM judge at temperature 0, plus a human spot-check of 10 turns | "Automated judge" / "Human" |
| Answered instead of interpreted | Realtime primarily, both reported | Heuristic flag plus a manual review list | Rate per mode |

**Disclosure:** Realtime's input transcript comes from a side transcription
process, so its source-side WER does not measure what the model
understood.

## 5. Cost
- Log usage per turn: audio seconds, tokens, and characters, by provider.
- Cost per minute = usage × `harness/pricing.json`.
- Every price carries a source and a verified-on date. Unverified prices are
  flagged in the report.

## 6. Run conditions (attached to every turn and every export)

```json
{
  "runId": "string",
  "mode": "realtime | cascade",
  "strategy": "segment | clause | null",
  "providers": { "stt": "", "translation": "", "translationFallback": "", "tts": "", "realtimeModel": "" },
  "direction": "en-es | es-en",
  "input": "microphone | replay:<clipId>",
  "failover": "none | <provider>@<turnId>",
  "build": "<git short sha>",
  "timestamp": "ISO-8601"
}
```

## 7. Procedures

**Replay runs:** every clip through four configurations:
1. Realtime
2. Cascade-segment
3. Cascade-clause
4. Cascade-segment with DeepL as primary translator (provider flexibility
   evidence; config change only)

Runs are automated with Playwright's fake audio capture. Limit: 3 full runs
per configuration (cost guardrail).

**Soak:** 5 minutes per mode, looping clips, with one forced transport drop
mid-run.

**Onboarding exercise:** add EN↔FR via config plus 2 clips per direction.
Record the files touched and the effort per architecture.

**Live-voice session:** at least one real-voice session per mode,
complementing the synthetic clips (D-24).

**Reporting rules:**
- Every number in `docs/comparison.md` must trace to `harness/results/`.
- The comparison must include these disclosures:
  - synthetic clips
  - the cascade's extra backend hop
  - consecutive pre-synthesis favoring the cascade
  - the Realtime side transcript

## 8. As implemented

Mapped from the code at commit 13d7a09. Sections 1-7 above are unchanged.
Deviations are listed in 8.7 and mirrored in `docs/decisions.md` "Changes
during the build". Sequence diagrams showing where each mark is captured:
[`architecture/sequences.md`](architecture/sequences.md).

### 8.1 Timing marks

All browser marks use `performance.now()`. Marks live on the turn record in
`client/src/state/metrics.ts` (`MarkName`, `MetricsStore.mark` / `setMark`;
first write wins).

| Mark (section 2) | Field | Implemented in | Test |
|---|---|---|---|
| `press` | `marks.press` | `client/src/session/controller.ts` `startTurn` -> `MetricsStore.startTurn` | `e2e/audio-engine.spec.ts` "replay produces press, access, T0 and release marks in order" |
| `access` | `marks.access` | Cascade: `client/src/transports/cascade/CascadeTransport.ts` (first frame sent on the WebSocket). Realtime: `client/src/transports/realtime/RealtimeTransport.ts` `startTurn` (track already live; press plus the `session.update` / `clear` send) | same e2e test |
| `T0` | `marks.t0` | `client/src/audio/energyDetector.ts` (-45 dBFS, last voiced frame, stamped on the capture clock); set in `controller.ts` `completeRelease`, capped at release | `client/src/audio/dsp.test.ts` "EnergyDetector" |
| (extra) `speechStart` | `marks.speechStart` | `controller.ts` `onFrame` | same |
| `release` | `marks.release` | `controller.ts` `releaseTurn` | same e2e test |
| `stt_final` | `marks.sttFinal` + `stages[]` | Server: `CascadeTurnPipeline.cs` `_sinceRelease` Stopwatch -> `stage.timing`. Browser: `MetricsStore.stage` maps the stage to a mark at receipt time (`STAGE_MARK`) | `CascadePipelineTests`, `client/src/state/metrics.test.ts` "stage marks follow the latest segment" |
| `translate_first_token` / `translate_done` | `marks.translateFirstToken` / `translateDone` | Server Stopwatch per segment in `CascadeTurnPipeline.cs` (translate loop); mapped on receipt | same |
| `tts_first_byte` | `marks.ttsFirstByte` | Server Stopwatch per segment in `CascadeTurnPipeline.cs` (TTS loop); mapped on receipt | same |
| `rt_response_start` | `marks.rtResponseStart` | `client/src/transports/realtime/eventMapper.ts` on `response.created` over the data channel | `eventMapper.test.ts` "maps a full turn to normalized events, marks and playback signals" |
| `first_audible` | `marks.firstAudible` | Cascade: `client/src/audio/player.ts` `onFirstAudible` via the playback-tap `OutputTap` (`dsp.ts`), time from `getOutputTimestamp` (`audio/clock.ts`). Realtime: AnalyserNode tap on the remote track, `client/src/audio/remoteTap.ts` (polled every 5 ms), wired in `RealtimeTransport.ts` | `dsp.test.ts` "OutputTap", `e2e/realtime.spec.ts` |

**Exclusion rule:** `client/src/audio/denyTone.ts` connects straight to the
destination, never through the playback tap. `controller.ts`
`denyToneWindow` also keeps the tone out of the energy detector. Tests:
`denyTone.test.ts` "never produces first_audible...", `e2e/audio-engine.spec.ts`
floor-deny test.

### 8.2 Metrics

| Metric (section 3) | Implemented in | Where reported |
|---|---|---|
| Mouth-to-ear | `metrics.ts` `mouthToEarMs` (`firstAudible - t0`) | UI headline (`client/src/ui/LatencyPanel.tsx`), `harness/report.ts` section 1, p50/p95 via `harness/metrics.ts` `percentile` |
| Stage breakdown | `LatencyPanel.tsx` waterfall (final segment, ms after T0; "during speech" if before T0; Realtime rows "hidden"); `report.ts` "Stage breakdown" and "Server stage durations" | UI, `harness/results/report.md` |
| Access time | `metrics.ts` `accessMs` | UI, report section 1 |
| Release lag | `report.ts` `since(t, "release")` | report section 1 (release -> first audible column) |
| Disconnects | `harness/soak.harness.ts` (connection changes to Reconnecting or Failed) | report section 5 |
| Recovery time | `soak.harness.ts` forced drop at the midpoint (`forceDrop`), time to Ready, transcript count before and after | report section 5 |
| Playback buffer depth | Cascade: `soak.harness.ts` samples `bufferedSamples` and `underruns` from the transport's `diagnostics()`. Realtime: `client/src/transports/realtime/rtcStats.ts` reads WebRTC `getStats()` inbound audio (average jitter-buffer delay, concealed samples, packets lost) per turn (release to end of playback) and every 2 s for the soak | report section 5 (cascade depth; Realtime "playback health" subsection) |
| Memory growth | `soak.harness.ts` samples `usedJSHeapSize`; report shows the post-GC floor, first vs last minute | report section 5 (browser only) |

### 8.3 Quality

| Measure (section 4) | Implemented in | Test |
|---|---|---|
| Source WER | `harness/metrics.ts` `normalize` + `wer` (word Levenshtein, small numbers spelled out) | `harness/metrics.test.ts` "normalize / wer" |
| Target WER (crude proxy) | same, against `scripts.json` reference translations; labelled in the report | same |
| Rubric (automated judge) | `harness/report.ts` `judge`: gpt-4.1-mini, temperature 0, JSON output, cached in `harness/results/judge-cache.json` | none (live call; cached results) |
| Rubric (human, blind) | Scoring page (blind, random order) for 10 turns per mode from each mode's first run; results joined to the judge in `harness/results/human-scores.json`; `report.ts` "Human spot-check" | Done 2026-10-15 by the project owner |
| Answered instead of interpreted | `harness/metrics.ts` `answeredHeuristic` + the judge's flag; `report.ts` "Manual review list (flagged turns)" | `harness/metrics.test.ts` "answered instead of interpreted" |

### 8.4 Cost

| Item (section 5) | Implemented in |
|---|---|
| Usage per turn | Server `TurnMeter` (`Workbench.Core/Contracts/Providers.cs`) -> `turn.end.usage`; Realtime token usage from `response.done` in `eventMapper.ts` |
| Cost per minute | `harness/metrics.ts` `turnCost` x `harness/pricing.json`; `report.ts` section 3. Test: `harness/metrics.test.ts` "turnCost" |
| Source and date per price | `harness/pricing.json` (read 2026-10-15, marked "verify"); the DeepL rate is shown as unverified in the report |

### 8.5 Run conditions

As built, per turn (`client/src/state/metrics.ts` `RunConditions` and
`TurnRecord`): `mode`, `strategy`, `providers[]` (plus `providersUsed`
from `turn.end`), `pair`, `direction`, `inputSource`, `controls`,
`startedAtIso`, `failoverNote`, `usage`, `runId` (one per page session) and
`build` (the server's short git sha from `/api/health`, stamped into the
assembly at build time by the SDK: `server/src/Workbench.Api/Config/BuildInfo.cs`).
Per run file
(`harness/run.harness.ts`): `config`, `label`, `startedAt`, `finishedAt`,
`browser`, `pageReloads`, `runId`, `build`. Runs saved before these fields
existed show the commit that was HEAD at their start, marked "(inferred)", in
the report's run table (`harness/report.ts` `buildOf`). Exported by the UI's Export button
(`MetricsStore.export`; test "exports JSON with derived latencies").

### 8.6 Procedures

| Procedure (section 7) | Implemented in | Evidence |
|---|---|---|
| Replay runs, four configurations | `harness/run.harness.ts`, configs in `harness/lib.ts` (`realtime`, `cascade-segment`, `cascade-clause`, `cascade-deepl`) | `harness/results/runs/`, `harness/results/report.md` |
| Run limit (3 per configuration) | `harness/lib.ts` `MAX_RUNS_PER_CONFIG = 3`, enforced by `test.skip` in `run.harness.ts` | Realtime 3/3, cascade configs 2/3 each |
| Soak (5 min per mode, one forced drop) | `harness/soak.harness.ts` | `harness/results/soak-realtime.json`, `soak-cascade.json` |
| Onboarding exercise (EN<->FR) | `harness/onboarding.harness.ts` | `harness/results/onboarding.md` |
| Live-voice session per mode | Not run as a recorded procedure | Gap in `docs/status.md` |
| Traceability and disclosures | `docs/comparison.md` cites `harness/results/report.md` and carries all four disclosures | `docs/conformance.md` |

### 8.7 Deviations from sections 1-7

| Section | Protocol says | As built | Reason |
|---|---|---|---|
| 2 | `stt_final` etc. are server durations "mapped on receipt" | Two values are kept: the server Stopwatch duration in `stages[]` (report "Server stage durations") and the browser receipt time as the mark (waterfall) | The waterfall needs browser-clock positions; the durations stay pure server Stopwatch |
| 2 | `first_audible` from the playback tap in both cases | Cascade time comes from `getOutputTimestamp` (includes device output latency); the Realtime AnalyserNode sees samples just before output | Browser APIs differ per path. Not corrected (a correction would be an estimate); disclosed in `docs/comparison.md` |
| 3 | Access time "audio flowing" for Realtime | Realtime access is press plus the send of `session.update` / `clear`, near zero, because the WebRTC track is always live | No per-turn audio start exists on a live track |
| 3 | Playback buffer depth for both modes | Cascade: depth over time. Realtime: average jitter-buffer delay and concealment from `getStats()`, not depth over time | Realtime's jitter buffer belongs to the browser; `getStats()` exposes only cumulative counters |
| 3 | Memory: browser heap and server memory | Browser heap only, reported as post-GC floor plus raw start/end | Raw heap saw-tooths without forced GC; server memory sampling was not built |
| 4 | Human spot-check of 10 turns | 20 turns (10 per mode), scored blind | One mode per 10 turns allows a per-mode comparison with the judge |
| 6 | `runId`, `providers` object, `failover`, `build` sha, `timestamp` | `runId` and `build` added after the first evaluation (runs before that are inferred, see 8.5); failover is a per-turn `failoverNote`; providers is an array | The schema was written after the build; the two missing fields were added in the product follow-ups |
| 7 | Playwright fake audio capture | The app's Replay input (same capture graph as the mic, press/release automated) | The fake capture file loops from browser start and cannot be aligned with a press |
| 7 | Live-voice session per mode | Not recorded | Out of the unattended run; needs a person |

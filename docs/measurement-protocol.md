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
(Filled from the code: for each mark, metric, quality measure, cost item,
and procedure above, give the implementing file, function, or test, and any
deviation from this protocol, with its reason.)

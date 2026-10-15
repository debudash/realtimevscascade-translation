# Status

Snapshot as of 2026-10-15, end of the product follow-ups round (Test Runs
and Documentation tabs, live-voice session). `PROGRESS.md` stays the run
log; this page is the summary. It is updated at the end of every milestone
(CLAUDE.md).

## Metrics vs. targets

**Harness, synthetic clips** ([`harness/results/report.md`](../harness/results/report.md),
pooled runs, Clinic terms off):

| Metric | Target | Realtime | Cascade segment | Cascade clause | Cascade DeepL | Verdict |
|---|---|---|---|---|---|---|
| Mouth-to-ear p50 | - | 1.09 s | 1.43 s | 1.21 s | 1.15 s | - |
| Mouth-to-ear p95 | Realtime < 1.5 s; cascade < 3 s, stretch < 2 s | 1.46 s (72 turns) | 1.89 s (48) | 1.44 s (48) | 1.25 s (48) | All met |
| Realtime p95 per harness run | < 1.5 s | 1.06 / 1.72 / 1.36 s | - | - | - | One early run alone missed (accepted: owner decision) |
| Cost per minute | - | $0.210 | $0.043 | $0.044 | $0.066 | OpenAI, Deepgram, ElevenLabs prices verified; DeepL unverified |
| Target WER (proxy) | - | 0.097 | 0.059 | 0.088 | 0.293 | - |
| Automated judge (acc / comp / flu) | - | 4.96 / 4.97 / 4.99 | 4.96 / 5.00 / 5.00 | 4.83 / 4.88 / 4.71 | 4.96 / 5.00 / 4.96 | Checked by the human spot-check below |
| Human spot-check, blind (10 turns per mode) | - | 4.70 / 4.60 / 4.60 | 5.00 / 4.60 / 4.80 | - | - | 44/60 scores identical to the judge, all within one point |
| Answered instead of interpreted | 0 | 0 / 72 | 0 / 48 | 0 / 48 | 0 / 48 | Met |
| 5-minute soak | No disconnects, drift or leaks | 45 turns, 0 failures, drop recovered in 2.1 s | 45 turns, 0 failures, recovered in 1.1 s, 0 underruns | - | - | Met for 5 min; heap floor +4.9 / +3.7 MB (documented) |

**Live voice, one English speaker** (report §7, English to Spanish only):

| | Mouth-to-ear p50 / p95 | Release lag p50 | Source WER | Playback health |
|---|---|---|---|---|
| Realtime (Clinic terms on) | 0.87 / 1.24 s | 0.15 s | 0.021 | jitter buffer 30 ms, 0% concealed, 0 lost |
| Cascade segment (Clinic terms off) | 1.27 / 1.81 s | 0.15 s | 0.017 | - |

The harness releases 0.41 s after speech end; a real speaker released
after 0.15 s, so the harness numbers are conservative by about 0.26 s in
both modes.

**Test Runs from the UI** (`harness/results/test-runs/`, Clinic terms on,
real providers): Realtime p95 1.30 s (24 clips) and 1.17 s (12); Cascade
segment p95 2.10 s and 1.88 s (12 each). All under target.

**Translation controls** (formal register + clinic glossary, one run each):
DeepL 9/9 formal and 14/14 glossary terms; OpenAI translator 8/8 and 14/14;
Realtime 7/7 and 13/14. See [`translation-controls.md`](translation-controls.md).

## Gaps closed in this round

| Gap | How it was closed | Where |
|---|---|---|
| No human quality scoring | Blind scoring page, 20 turns | report §2, `harness/results/human-scores.json` |
| Run conditions lacked `runId` and build sha | Both on every turn and run file | `abb7f51`, report run table |
| Realtime playback jitter not observable | WebRTC `getStats()` per turn and in the soak | `06a4bab`, report §5 and §7 |
| Unverified prices | Three of four verified on official pages; DeepL quantified | `harness/pricing.json`, comparison §3 |
| No live-voice session | English session, both modes | report §7 |
| Turn-level `rate_limited` shown as a provider error | "Rate limited at {stage} (HTTP 429)" | `19466eb` |
| Heap growth, segment-level TTS | Documented with production handling | [`production.md`](production.md) |

## Open items

| Item | Type | Note |
|---|---|---|
| DeepL API price unverified | Owner / research | deepl.com does not publish the API rate in a readable form; impact about $0.0025/min |
| Heap floor growth over long sessions | Product | 5-minute soak only; a 30-60 minute soak with fake providers would separate retention from a leak at no cost ([`production.md`](production.md) §1) |
| Realtime jitter-buffer depth over time | Platform limit | Only averages are exposed by `getStats()` |
| Segment-level TTS | Product, by design | At most about 0.15 s at p50 ([`production.md`](production.md) §2) |
| Spanish to English never tested with a live speaker | Owner | No Spanish speaker available |
| Glossary tested only on the clips it was written for | Product | Needs held-out sentences |
| Merge requests | Owner | !1 open; this branch (`docs/round-wrap-up`) to follow |

## Uncommitted WIP, owner decision needed

None. The owner's four Test Runs were committed as data (`ba1ce6e`).

## Next actions

1. Owner: review and merge !1, then the wrap-up branch; then `git checkout main && git pull`.
2. Optional, no API cost: a 30-60 minute soak with fake providers and heap snapshots.
3. Optional: held-out sentences for the glossary; a Spanish-speaking live session.

See [`conformance.md`](conformance.md) for the full check.

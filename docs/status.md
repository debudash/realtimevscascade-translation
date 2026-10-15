# Status

Snapshot as of 2026-10-15, after the conformance fix. `PROGRESS.md` stays
the run log; this page is the summary. It is updated at the end of every
milestone (CLAUDE.md).

## Metrics vs. targets

From [`harness/results/report.md`](../harness/results/report.md) (pooled
runs, translation controls off). Details and disclosures in
[`comparison.md`](comparison.md).

| Metric | Target | Realtime | Cascade segment | Cascade clause | Cascade DeepL | Verdict |
|---|---|---|---|---|---|---|
| Mouth-to-ear p50 | - | 1.09 s | 1.43 s | 1.21 s | 1.15 s | - |
| Mouth-to-ear p95 | Realtime < 1.5 s; cascade < 3 s, stretch < 2 s | 1.46 s (72 turns) | 1.89 s (48) | 1.44 s (48) | 1.25 s (48) | All met; Realtime narrowly |
| Realtime p95 per run | < 1.5 s | 1.06 / 1.72 / 1.36 s | - | - | - | One run alone missed |
| Cost per minute | - | $0.210 | $0.043 | - | $0.066 | Prices unverified |
| Target WER (proxy) | - | 0.097 | 0.059 | 0.088 | 0.293 | - |
| Automated judge (acc / comp / flu) | - | 4.96 / 4.97 / 4.99 | 4.96 / 5.00 / 5.00 | 4.83 / 4.88 / 4.71 | 4.96 / 5.00 / 4.96 | Human check pending |
| Answered instead of interpreted | 0 | 0 / 72 | 0 / 48 | 0 / 48 | 0 / 48 | Met |
| 5-minute soak | No disconnects, drift or leaks | 45 turns, 0 failures, drop recovered in 2.1 s | 45 turns, 0 failures, recovered in 1.1 s, 0 underruns | - | - | Met for 5 min; heap floor +4.9 MB (Realtime), +3.7 MB (cascade) |

Translation controls (formal register + clinic glossary, one run each):
DeepL 9/9 formal and 14/14 glossary terms; OpenAI translator 8/8 and 14/14;
Realtime 7/7 and 13/14. See [`translation-controls.md`](translation-controls.md).

## Open product gaps

| Gap | Impact | What would close it |
|---|---|---|
| No human quality scoring | "Subjective" quality rests on the automated judge only (M2, D-17) | Fill the human sheet in `MORNING.md` (10 turns) |
| Realtime single-run p95 1.72 s | The < 1.5 s target holds pooled (1.46 s) but not per run; 3 of 3 harness runs used, so no budget left to re-measure | Owner decision: raise the run cap or accept the pooled figure |
| Heap floor growth over 45 turns (Realtime 12.6 -> 17.5 MB, cascade 12.4 -> 16.1 MB), unresolved | A slow leak beyond 5 minutes is not ruled out | A longer soak with transcript retention capped (needs a soak budget) |
| Realtime playback jitter not observable | Buffer depth and drift are measured for the cascade only (D-15) | None inside the browser; disclosed |
| Segment-granularity TTS | TTS starts per committed segment after its translation completes, not mid-segment (F3) | Stream translation tokens into TTS (product change) |
| Unverified prices | Cost cell rests on prices marked "verify"; the DeepL rate is unverified (D-19) | Check provider pricing pages and update `harness/pricing.json` |
| No live-voice session recorded | Recommendations rest on synthetic clips (D-24) | One real-voice session per mode, exported |
| Run conditions lack `runId` and `build` sha | Runs trace by file name and date, not by commit (C-09) | Add both fields to `RunConditions` (product change) |
| Turn-level `rate_limited` shows as "Provider error at {stage}" | The card title is generic; the failover toast and banner are correct | Add a rate-limit title on the turn card (product change) |
| Glossary tested on the clips it was written for | Controls results are not an unbiased estimate | Held-out sentences |

## Uncommitted WIP, owner decision needed

None at the time of writing (`git status` clean before this fix started).

The translation-controls changes that this morning's conformity check saw as
uncommitted (in `harness/report.ts`, `run.harness.ts`, providers, pipeline
and transports) were in progress in another session at that time. They were
tested and committed afterwards in 56cecb1 (code, 77 xUnit and 85 vitest
passing), 04b0e30 (docs) and 7e168f9 (Clinic terms toggle). Their baseline
harness configurations pin `controls=off`, so `harness/results/report.md`
still matches `comparison.md`. Owner decision still open: whether the
controls should stay on by default (they are, via `TranslationControls.Enabled`).

## Next actions

1. Owner: push `main` (`git push -u origin main`); nothing has been pushed.
2. Owner: fill the human scoring sheet in `MORNING.md`.
3. Owner: decide on the Realtime run budget and the controls default.
4. Verify prices and re-run `npm run report` (free: judge results are cached).
5. Record one live-voice session per mode.
6. Held-out sentences for the glossary.

See [`conformance.md`](conformance.md) for the full check.

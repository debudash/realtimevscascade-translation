# 03 · Product follow-ups (plan, written before the work)

Started 2026-10-15 after the conformance fix and the first push (6eb52f2).
The owner went through the open product gaps in `docs/status.md` one by one
and decided each. Each item below is done separately, test-first where it
touches code, and committed on its own with a body saying why.

| # | Gap | Decision | Paid API cost |
|---|---|---|---|
| 9 | Turn-level `rate_limited` shows "Provider error at {stage}" | Fix the card title; e2e with fake 429s on TTS (no fallback) | none |
| 8 | Run conditions lack `runId` and `build` sha | Add both, server reports the sha; tests | none |
| 4 | Realtime playback jitter not observable | Sample `RTCPeerConnection.getStats()` inbound audio (jitter-buffer delay, concealment) | one small run, asked first |
| 6 | Prices unverified | Verify from provider pricing pages, record URL and date, rebuild the report | none |
| 3 | Heap growth unresolved | Document it, plus memory management and mitigation in production | none |
| 5 | Segment-level TTS | Document as a known limit, plus the production approach | none |
| 1 | No human quality scoring | Scoring page; the owner scores 10 turns; results next to the judge's | none |
| 7 | No live-voice session | Script per mode; the owner speaks; analysis added to report and comparison | cents |
| 2 | Realtime single-run p95 1.72 s | Accept the pooled p95 and keep the disclosure | none |

Order: 9, 8, 4 (code, test-first), then 6, 3, 5 (docs), then 1 and 7
(need the owner), then the paid run for 4 only after asking.

Commit rules (CLAUDE.md standing rule 10): a short body with the reason,
one concern per commit, measured data in its own `data(harness): ...`
commit. `docs/status.md` and `docs/conformance.md` are updated at the end.

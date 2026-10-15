# 04 · Test Runs tab (plan, written before the work)

Requested 2026-10-15 by the owner: a tab where a tester creates a test run
from chosen replay clips and one setup (Realtime or a cascade option),
collects the run's metrics, and keeps every test run. The owner named
the feature "Test Runs" (not "experiments").

Confirmed design:
- Tabs: Workbench (the current page) and Test Runs.
- One setup per test run: Realtime, Cascade segment, Cascade clause, or
  Cascade with the DeepL translator, plus Clinic terms on or off.
- Utterances: all 24, EN 12, ES 12, or picked clips; 1-3 passes.
- Cost and time estimate before Start (voiced minutes x measured cost per
  minute), confirmed on Start.
- The run plays each clip through the replay path, as the harness does,
  with progress and Cancel; setup controls are locked while it runs.
- Metrics: mouth-to-ear p50/p95 vs target, access time, stage p50s, source
  and target WER, cost per turn and per minute. The LLM judge stays offline.
- Storage: `harness/results/test-runs/<id>.json` through
  `GET /api/test-runs`, `GET /api/test-runs/{id}`, `POST /api/test-runs`.
- Saved list, detail view with every turn, Export, and Compare for two
  saved test runs (summaries and per-clip delta).

Build order, each its own commit and test-first: WER into the client;
test-runs API and store; controller setup switching; the tab (runner,
list, detail, compare); docs (UI spec, decisions C-23, README, status).

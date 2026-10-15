# 04 · Experiments tab (plan, written before the work)

Requested 2026-10-15 by the owner: a tab where a tester creates a test run
from chosen replay clips and one setup (Realtime or a cascade option),
collects the run's metrics, and keeps every experiment.

Confirmed design:
- Tabs: Workbench (the current page) and Experiments.
- One setup per experiment: Realtime, Cascade segment, Cascade clause, or
  Cascade with the DeepL translator, plus Clinic terms on or off.
- Utterances: all 24, EN 12, ES 12, or picked clips; 1-3 passes.
- Cost and time estimate before Start (voiced minutes x measured cost per
  minute), confirmed on Start.
- The run plays each clip through the replay path, as the harness does,
  with progress and Cancel; setup controls are locked while it runs.
- Metrics: mouth-to-ear p50/p95 vs target, access time, stage p50s, source
  and target WER, cost per turn and per minute. The LLM judge stays offline.
- Storage: `harness/results/experiments/<id>.json` through
  `GET /api/experiments`, `GET /api/experiments/{id}`, `POST /api/experiments`.
- Saved list, detail view with every turn, Export, and Compare for two
  saved experiments (summaries and per-clip delta).

Build order, each its own commit and test-first: WER into the client;
experiments API and store; controller setup switching; the tab (runner,
list, detail, compare); docs (UI spec, decisions C-23, README, status).

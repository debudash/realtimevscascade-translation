# Build plan: plan vs. actual

Two plans existed. The **control-room plan** (milestones M0-M7 in the
control-room prompt, recorded in [`agent-log/02-conformance-fix.md`](agent-log/02-conformance-fix.md))
was never turned into a per-milestone build plan, because planning switched
to a build phase run by the agent from the pack (D-27). The **PROGRESS.md
plan** is what that phase executed. This page sets both against what was built and committed.

- Commits are from `git log` (local time, UTC-5).
- Elapsed times are **approximate**: they are differences between commit
  timestamps and transcript timestamps, and they measure agent wall clock,
  not human effort. The agent committed in batches (for example M1 and M2
  share 00:39), so per-milestone splits are rough.
- No planned commits existed: every "planned commits" cell is "not planned
  per-commit in this run".

## 1. Control-room milestones

The control-room prompt asked for hour estimates, acceptance criteria and
planned commits per milestone in this file. They were never written, so
none are shown here.

| # | Planned scope (control room) | Actual scope and where it landed | Planned commits | Actual commits |
|---|---|---|---|---|
| M0 | Scaffold and event schema | Built in PROGRESS M0 | not planned per-commit in this run | ee8e45c, a7a6e16, 70f82f0, 1fa517c |
| M1 | Audio engine, push-to-talk, replay source | Built in PROGRESS M1 (replay input in M1, automated replay turns) | not planned per-commit in this run | 47b73a6, 6709c9b, c6237a5, ee0a7a6, d9f5c82, 99d7815 |
| M2 | Realtime mode end to end, with timing marks | Built in PROGRESS M2 | not planned per-commit in this run | e14bbd9, 1d85624, 6a65d61, 3425a08, 0ab16af |
| M3 | Cascade with fake providers, plus tests | Built in PROGRESS M3, which also included the Polly retry and DeepL failover breaker | not planned per-commit in this run | ce8ac9d, fe82e27, 9f1d850, b35920c, c46433f, 5a7232d, 2cc1516 |
| M4 | Real adapters with segment commit, < 3 s | Built in PROGRESS M4 (all four adapters, DeepL included) | not planned per-commit in this run | 2873432, df174b9, 2f24196, fdc2ce4, 439ac5f |
| M5 | Clause-level commit and the DeepL adapter, toward < 2 s | Already done: clause policy in PROGRESS M3, DeepL adapter in M4. PROGRESS M5 was the full UI instead | not planned per-commit in this run | (in M3 and M4 commits above) |
| M6 | Error handling and the floor-deny UX | Already done: floor deny in PROGRESS M1, resilience in M3, error states in M5 (e6e3961) | not planned per-commit in this run | 9f1d850, e6e3961, 28e4ab0, a2992e0 |
| M7 | Soak test, harness report, comparison write-up | Soak and report in PROGRESS M6; comparison in PROGRESS M7 | not planned per-commit in this run | e9f631f, 2c42b5f, 75b4a86, 6d5b3e0, 3566a34, ba42cc1 |

The reorder is recorded as C-03 in [`decisions.md`](decisions.md).

## 2. PROGRESS.md milestones

Planned estimates are from the PROGRESS.md headings. "Actual" is the time
from the previous milestone's last commit (or the kickoff prompt at 23:57) to
this milestone's last commit.

| # | Planned scope (PROGRESS.md) | Est. | Actual scope | Commits | Last commit | Actual (approx.) |
|---|---|---|---|---|---|---|
| M0 | Scaffold, .env loading, contracts, health | 0.75 h | As planned; repo-local .NET SDK (C-11) | ee8e45c, a7a6e16, 70f82f0, 1fa517c | 00:10 | 0.2 h |
| M1 | Audio engine and floor control | 1.5 h | As planned; review fixed a press/release race and T0 clock bias (99d7815) | 47b73a6, 6709c9b, c6237a5, ee0a7a6, d9f5c82, 99d7815 | 00:39 | 0.5 h (M1 + M2) |
| M2 | Realtime mode end to end | 2 h | As planned; per-turn `session.update`, context pruned to 2 turns | e14bbd9, 1d85624, 6a65d61, 3425a08, 0ab16af | 00:39 | (with M1) |
| M3 | Cascade core with fakes | 2 h | As planned plus resilience; review fixed two lifecycle hangs (2cc1516) | ce8ac9d, fe82e27, 9f1d850, b35920c, c46433f, 5a7232d, 2cc1516 | 01:02 | 0.4 h |
| M4 | Real cascade providers | 2 h | As planned; clip generation pulled forward from M6 | 2873432, df174b9, 2f24196, fdc2ce4, 439ac5f | 01:07 | 0.1 h |
| M5 | Full UI per spec | 2 h | As planned | e6e3961 | 01:13 | 0.1 h |
| M6 | Evaluation harness, soak, onboarding | 2 h | As planned; first harness run of all four configs (01:17-01:28), soak per mode, EN-FR onboarding | e9f631f, 2c42b5f, 75b4a86, 1379e15 | 01:45 | 0.5 h |
| M7 | Review, docs, handoff | 1.5 h | As planned; second run of every config (01:59-02:07) and a third Realtime run (02:11) to settle variance; architecture review fixes (28e4ab0, a2992e0) | 6d5b3e0, 28e4ab0, a2992e0, 3566a34, ba42cc1 | 02:16 | 0.5 h |
| **Total** | | **13.75 h** | | 38 commits incl. the pack commit 18958de | | **about 2.3 h** |

The run took about 2.3 hours of agent wall clock from kickoff (23:57) to the
last M7 commit (02:16). The PROGRESS.md session log said "~07:30"; that was
the UTC time, corrected there.

## 3. Work after the run

| When (local) | What | Commits | Approx. |
|---|---|---|---|
| 23:20-23:57 (before kickoff) | `.env` refactor of the pack, key checks | in 18958de (pack commit) | 0.6 h |
| 06:51-07:43 | Translation controls (formality + glossary), before/after harness runs, write-up | 56cecb1, 04b0e30 | 0.9 h |
| 06:58-07:07 (separate session) | Conformity check against the control-room prompt (no changes) | none | 0.15 h |
| 07:47-08:39 | Planning docs committed, Clinic terms toggle, resume notes | a5f7616, 7e168f9, fdc469c | 0.9 h |
| 08:42-08:54 | Conformance fix (docs only) | 13d7a09 to 37127be | 0.25 h |
| 10:15-10:19 | Git history guide and commit rule; first push | 6eb52f2 | 0.1 h |
| 10:19-11:23 | Product follow-ups: rate-limit title, runId and build, getStats, prices, production notes, human scoring (includes the owner's scoring time) | 1c30dde to 8f7c4bd | 1.1 h |
| 11:30-11:52 | Compare modes row, scrolling transcripts | 802e18b to d2c1bf2 | 0.4 h |
| 11:55-12:20 | Test Runs tab (API, runner, UI) | 300b73b to bb2e528 | 0.45 h |
| 12:25-12:31 | Documentation tab | 1e3f900 | 0.15 h |
| 12:50-13:07 | Live voice in English (owner session, analysis), owner test runs as data | f5ed4c9 to ba1ce6e | 0.3 h |
| 13:07 onward | End-of-round wrap-up (status, conformance, architecture sync, logs) | `docs/round-wrap-up` branch | 0.3 h |

## 4. Hours against the 15-20 h budget

| Item | Hours (approx.) | Source |
|---|---|---|
| Planning session (brief analysis, decisions, design, pack) | not recorded | claude.ai conversation, not in this repo |
| Pre-kickoff setup | 0.6 | transcript timestamps |
| Build phase M0-M7 (agent, from the pack) | 2.3 | commit and transcript timestamps |
| Follow-ups, conformance and product rounds | 5.0 | commit and transcript timestamps (section 3) |
| **Recorded total** | **about 7.9** | |

The recorded total is agent wall clock, including short waits for the owner inside a round (for example the scoring and the live session). Human time spent planning and
reviewing is not recorded anywhere in the repo, so the budget comparison is
incomplete. From now on, CLAUDE.md requires hours to be tracked here per
milestone.

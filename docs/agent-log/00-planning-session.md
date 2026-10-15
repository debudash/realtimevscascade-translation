# 00 · Planning session (Claude, claude.ai Project "Boostlingo")

## How the agent was directed

Planning happened in a conversation with Claude before any code was written.
The coding agent (Claude Code in VS Code) never saw this conversation. It
received only its output: the starter pack.

**Sequence:**
1. Analyzed the brief to find the hardest part: the cascade commit policy
   and the latency instrumentation.
2. Produced reference architectures, first in C#/.NET, then in Python, then
   settled back on C#/.NET (D-02).
3. Brainstormed UX against the eight must-haves, then audited the design for
   defensibility. That audit produced three fixes: acoustic T0 (D-14),
   segment commit during speech (D-13), and quality defined honestly per
   mode (D-17).
4. Locked the turn model: two push-to-talk buttons (D-09), consecutive
   playback (D-10), floor deny with a tone (D-11).
5. Rejected a separate call-processing / media-server topology in favor of
   one process with two modules (D-04).
6. Mapped metrics to the brief using 3GPP terms only where they fit (D-15).
7. Wrote a control-room prompt for a Claude Project. It defined a nine-doc
   pack and DOCS / NEXT / REVIEW / STATUS modes.
8. Updated the UI design artifact to match the decisions (D-26).
9. Replaced the control-room loop with a build phase run by the agent from a
   prepared pack, followed by owner-directed rounds (D-27),
   using a starter pack: CLAUDE.md, PROGRESS.md, docs/architecture.md,
   docs/ui-spec.md, docs/design/, .claude/settings.json, KICKOFF.md.
10. Moved secrets to a gitignored `.env` (D-22).

## Prompts that started the build
- **Kickoff prompt:** see `KICKOFF.md`, section "Kickoff prompt."
- **Resume prompt, if used:** see `KICKOFF.md`, section "If the run stopped
  early."
- **Pre-kickoff `.env` change prompt:** applied before kickoff (D-22).

## Known process gap
The control-room doc pack was compressed into the starter pack without a
line-by-line reconciliation. As a result, `decisions.md`,
`measurement-protocol.md`, `build-plan.md`, `status.md`, the agent log, and
the sequence diagrams were never queued for the run. The post-run conformity
check found them missing. This entry, `docs/decisions.md`, and
`docs/measurement-protocol.md` were produced afterwards in the planning
session to close that gap.

## Prompts actually sent (from the transcripts)
- [01-initial-build.md](01-initial-build.md): pre-kickoff setup and the
  kickoff prompt, with timestamps.
- [02-conformance-fix.md](02-conformance-fix.md): the first owner-directed follow-ups,
  the conformity check (with the full control-room prompt) and the
  conformance fix.

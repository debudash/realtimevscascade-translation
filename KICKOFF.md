# KICKOFF: start the overnight build

## Before bed (about 15 minutes)

### 1. Prerequisites
Each one should print a version:
- `dotnet --version` (current .NET LTS SDK)
- `node --version` (current LTS)
- `git --version`

Claude Code should already be signed in, in VS Code.

### 2. API keys in .env
Copy `.env.example` to `.env` in this folder and paste your four keys. No
restart needed.

### 3. Open this folder in VS Code
Unzip the pack into an empty folder first.

### 4. Keep the machine awake
Plug it in.
- **Windows:** Settings > System > Power > Sleep = Never.
- **macOS:** run `caffeinate -dimsu` in a terminal and leave that terminal
  open.

### 5. Open a new Claude Code conversation
Set the permission mode (the indicator at the bottom of the prompt box) to
**Auto**. If Auto isn't offered, use **Edit automatically**. The rules in
`.claude/settings.json` pre-approve build, test, and git-commit commands.

### 6. Paste the kickoff prompt below and send it

### 7. Watch the first 10-15 minutes, until M0 commits
If any approval prompt appears, choose the "don't ask again" option, so it
won't block the run later.

## Kickoff prompt (paste this)

```
You are running unattended overnight. I will not be available to answer questions.

Read @CLAUDE.md, @PROGRESS.md, @docs/architecture.md and @docs/ui-spec.md, then skim @docs/brief.md and the design files in @docs/design/.

Execute PROGRESS.md from M0 through M7 in order, following the autonomous protocol in CLAUDE.md:
- After each milestone: build, run all tests, self-review against the acceptance criteria and CLAUDE.md (use a subagent reviewer if available), fix what you find, update PROGRESS.md, and commit with scoped messages.
- Verify every provider API against its current official docs before writing the adapter.
- If something is blocked, implement against fakes, mark it BLOCKED in PROGRESS.md with the reason, and keep going. Never retry the same failure more than 3 times.
- Respect the cost guardrails and the safety rules. Never push, and never write or print API keys.

Finish M7 by writing MORNING.md, then start `npm run dev` as a background task, confirm it is healthy, and leave it running for me. Start now with M0.
```

## If the run stopped early
For example, after a usage limit or a closed laptop. Open a new conversation
and paste:

```
Resume the unattended build. Read @CLAUDE.md and @PROGRESS.md, run `git log --oneline -20` to see what is done, and continue from the first unchecked item in PROGRESS.md with the same autonomous protocol. Finish with M7 and MORNING.md, and leave `npm run dev` running.
```

## In the morning
1. Open http://localhost:5173. The app should already be running. If it
   isn't, run `npm run dev` in the integrated terminal.
2. Follow `MORNING.md`: the 5-minute test script, the results table, and the
   10-turn scoring sheet.
3. Check `PROGRESS.md` for anything marked BLOCKED or partial.

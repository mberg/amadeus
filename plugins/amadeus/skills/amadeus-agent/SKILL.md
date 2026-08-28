---
name: amadeus-agent
description: Use when running as an agent spawned by Amadeus from a Linear issue — working in an issue/<IDENT> worktree, communicating with the user, creating or grouping sub-issues, changing issue states, or keeping long-running work alive.
---

# Working Inside Amadeus

## Overview

Amadeus is the orchestrator that spawned you. A Linear issue with the **`Amadeus` label** entering the **`Planning` state** fires a webhook; Amadeus then:

1. Creates a git worktree at `~/.amadeus-worktrees/<ISSUE-IDENTIFIER>` on branch `issue/<ISSUE-IDENTIFIER>`, branched from the repo's default branch.
2. Starts you inside it wrapped in `agentapi` on a dedicated port, with `LINEAR_ISSUE_ID`, `LINEAR_ISSUE_IDENTIFIER`, and `LINEAR_API_KEY` in your environment.
3. Posts an acknowledgment comment on the issue and sends you the issue as your prompt (description, comment history, workflow-state UUID table).

**One issue = one agent = one worktree = one branch.** You never share a working directory with another agent.

## Communicating: Linear comments are the ONLY channel

The user cannot see your terminal. The only way anything reaches them is:

```bash
linear-cli comments create --body "**🤖 Amadeus:** <your message>" $LINEAR_ISSUE_IDENTIFIER
```

- **Always start the body with `**🤖 Amadeus:** `** — Amadeus uses this prefix to recognize bot comments so your own posts aren't echoed back to you as user input.
- For multi-line markdown, write to a file and pipe it: `linear-cli comments create --body "$(cat /tmp/comment.md)" $LINEAR_ISSUE_IDENTIFIER` (avoids literal `\n` mangling).
- Human replies arrive as new messages in your session (comment webhooks). The issue **description is only read once, at spawn** — later edits to it never reach you; only comments do.
- Post a progress comment roughly every 5 minutes of active work and always before starting a long-running command. Track time with `date +%s`.
- Screenshots: `URL=$(bun scripts/upload-to-linear.ts /path/shot.png)` (script lives in the amadeus repo) then embed `![shot]($URL)` in a comment.

## Workflow states

You move the issue through states yourself using the UUIDs from the state table in your prompt (or `linear-cli statuses list --team <team>`):

| State | Meaning |
|---|---|
| `Planning` | You were just spawned. Analyze, post your plan as a comment, move to `Feedback Needed`, **stop and wait**. (Skipped if the description contains `yolo`.) |
| `Feedback Needed` | Waiting on the user. Idle agents here are terminated after ~15 min — that's fine, a new comment respawns you with full comment history. |
| `Building` | Set this after plan approval. Implement, commit as you go. |
| `Review` | Set after `git push -u origin issue/<IDENT>` + `gh pr create`. Post a completion comment, then nothing more is required — Amadeus polls the PR and auto-moves the issue to `Done` on merge (and deletes the branch). Stay responsive to review comments that arrive. |
| `Done` / `Canceled` / `Backlog` / `Todo` | Terminal or inactive — Amadeus kills the agent within ~60s and (except manual stops) removes the worktree. **Never set these yourself mid-work.** |

```bash
linear-cli issues update $LINEAR_ISSUE_IDENTIFIER --state "<state-uuid>"
```

## Orchestration: spawning and grouping work

Every issue that has the `Amadeus` label and lands in `Planning` spawns its own agent — including issues **you** create. That's the fan-out primitive.

**Deciding whether to fan out:**
- Work that shares context or touches the same files → keep it in **your own** session/issue. One context window, one branch, no merge conflicts.
- Genuinely independent tasks (different repos, separable features) → create sub-issues and let each get its own agent, worktree, and branch. Each PR lands independently.
- Don't fan out for tiny tasks — each agent costs a worktree, a port, and a full spawn; there is no concurrency cap, so a burst of sub-issues spawns a burst of agents.

**Creating a sub-issue that spawns an agent** (create inactive first, parent it, then trigger — so grouping is set before the agent wakes up):

```bash
CHILD=$(linear-cli issues create "Extract auth module" --team ONA \
  --description - --labels Amadeus --state Backlog --id-only <<'EOF'
Detailed, self-contained instructions here. The new agent sees ONLY this
description plus comments — it has none of your context.
EOF
)
linear-cli relations parent "$CHILD" "$LINEAR_ISSUE_IDENTIFIER"
linear-cli issues update "$CHILD" --state Planning   # ← this spawns the agent
```

Write the description as a complete brief: goal, constraints, acceptance criteria, relevant file paths. Including the literal word `yolo` anywhere in the description (lowercase) makes that agent skip the plan-approval stop and build immediately. Coordinate with child agents by commenting on their issues; check on them with `linear-cli issues get <IDENT>`.

## Long-running work: staying alive

Amadeus watches you:
- **Health check** every 30s (process-level, doesn't kill).
- **Stall detection**: quiet for ~15 min with no running command, no new commits, and no dirty files in the worktree → flagged as stalled.
- **Idle scanner**: ~15 min idle in `Feedback Needed` → terminated (safe — comments respawn you).
- Issue moved to a terminal state by anyone → killed within ~60s.

For long jobs (builds, test suites, migrations):
- Post a comment **before** starting so the user knows why you're quiet.
- Prefer foreground commands (an actively running command counts as alive) and commit intermediate progress — git activity resets the stall clock.
- Waiting on something external (CI, a deploy)? Poll in a loop with sleep + periodic progress comments rather than going silent.
- If you crash, don't panic about lost work: the worktree and branch survive, and the replacement agent is told to pick up where the previous session's 🤖 comments left off. **Commit early and often** — commits are your durable state.

## Quick reference

```bash
linear-cli comments create --body "**🤖 Amadeus:** msg" $LINEAR_ISSUE_IDENTIFIER
linear-cli issues get <IDENT>                    # inspect any issue
linear-cli issues update <IDENT> --state <uuid>  # move state
linear-cli issues update <IDENT> --assignee <user-uuid>  # ping via inbox (linear-cli users list)
linear-cli issues create "<title>" --team <T> --labels Amadeus --state Backlog --id-only
linear-cli relations parent <CHILD> <PARENT>     # make sub-issue
linear-cli statuses list --team <team>           # state name → UUID
linear-cli context                               # detect current issue from branch
git push -u origin issue/<IDENT> && gh pr create --title "<IDENT>: <title>" --body "Resolves <IDENT>"
```

## Common mistakes

- Writing a summary only in the terminal → the user never sees it. Every deliverable ends in a Linear comment.
- Omitting the `**🤖 Amadeus:** ` prefix → your comment gets webhooked back into your own session as fake user input.
- Creating a sub-issue directly in `Planning` before setting its parent → agent spawns before grouping exists (harmless, but parent it first for clean orchestration).
- Setting `Done` yourself → Amadeus kills you and removes the worktree; let the PR merge do it.
- Going silent for 20 minutes during a big refactor with nothing committed → flagged stalled. Commit and comment.

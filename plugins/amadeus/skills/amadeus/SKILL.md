---
name: amadeus
description: Use when queueing, monitoring, or coordinating coding work through Amadeus (the Linear-driven Claude Code agent orchestrator) — creating issues that spawn agents, checking agent status, answering blocked agents, grouping related tasks, or sequencing dependent work.
---

# Managing Amadeus via Linear

## Mental model

Amadeus watches Linear webhooks and spawns **one Claude Code agent per issue**. Each agent gets its own git worktree, branch `issue/<IDENTIFIER>`, and port. Linear state transitions are the only control surface — Amadeus enforces nothing else (no dependency awareness, no "blocked by" handling).

An agent spawns when an issue **enters a trigger state** (default: `Planning`) or is assigned to the configured bot user. **If `agentName` is set in `amadeus.config.yaml` (e.g. `Amadeus`), the issue MUST also carry a label with that exact name — without it the issue is silently ignored, on both the state and assignment paths.** Check `global.agentName` and `global.triggerStates` in the config if unsure.

Preconditions: the machine server must be running (`bun run dev` in the amadeus repo; logs at `/tmp/amadeus.log`), and the issue's team workflow must contain the state names Amadeus expects (`Planning`, `Building`, `Review`, `Feedback Needed`) — a team missing them can spawn agents but the agents can't signal review/blocked states.

## State lifecycle

| State | Effect |
|---|---|
| Backlog / Todo | Inert — no agent. Moving a *running* issue here **kills its agent** |
| Planning | **Trigger** — agent spawns, analyzes, posts a plan comment |
| Building | Agent implementing (agent moves itself here) |
| Review | Agent finished; awaiting your review |
| Feedback Needed | Agent blocked on your input — reply with a comment |
| Done / Canceled | **Terminates the agent** |

Comments on an issue route directly to its running agent — you never need to change state just to talk to an agent. If the agent died, a comment **revives it with saved context**, but only while the issue sits in a trigger state or `Feedback Needed` (and has the agent label). A comment on a Backlog'd issue does nothing — resume killed work by moving the issue back to `Planning`, which spawns a fresh agent that starts over without the killed agent's context. Backlog/Done/Canceled teardown force-removes the worktree: **committed work survives on the `issue/<ID>` branch, uncommitted changes are lost.**

## CLI recipes (`linear`)

```bash
# Draft in Backlog first — creating directly in Planning spawns an agent
# against a half-written spec
linear issue create --team REC -t "Title" --description-file spec.md \
  -l Amadeus -s Backlog --no-interactive

# Release to an agent (this is the trigger)
linear issue update REC-123 -s Planning

# Status. -s takes state *types*; Planning/Building/Review/Feedback Needed
# are all type "started", so filter by type then read the state column
linear issue query --team REC -s started        # everything in flight, incl. blocked
linear issue view REC-123                       # details incl. agent comments
linear issue comment list REC-123

# Answer a blocked agent / steer a working one
linear issue comment add REC-123 -b "Use approach B, skip the migration"

# Abort an agent
linear issue update REC-123 -s Canceled
```

Also: dashboard at `http://localhost:5678` (agent list, live chat), logs at `tail -f /tmp/amadeus.log`.

## Labels

| Label | Effect |
|---|---|
| `Amadeus` (= configured agentName) | **Required gate** — no label, no agent |
| `profile:<name>` | Selects agent profile (e.g. `profile:frontend`) |
| Skill-profile name (`superpowers`, `frontend-design`) | Adds that skill bundle |
| `codex` / `claude` | Overrides agent type |

## Grouping work

- **One issue = one agent = one branch = one context.** Bundle small related changes in the same area into a single issue with a checklist — shared context, one PR, no cross-branch conflicts.
- Sub-issues do NOT share an agent: every issue hitting Planning gets its own agent and worktree. Split only work that is genuinely independent and parallel-safe (different files/areas).
- Two agents editing the same files in parallel = merge conflicts. Serialize those.

## Sequencing and gating

The state transition **is** the gate — Amadeus ignores Linear relations.

1. Create all issues in Backlog; add `blocked by` relations (`linear issue relation add REC-124 blocked_by REC-123`) for human visibility only.
2. Move only ready-to-run issues to Planning.
3. When a prerequisite reaches Review: review, merge its PR, move it to Done.
4. Only then release the dependent issue — its worktree is cut fresh, so it picks up the merged code.

## Common mistakes

- Forgetting the `Amadeus` label → nothing happens, no error anywhere.
- Creating an issue directly in Planning before the description is final.
- Moving an issue to Backlog/Todo to "pause" → that kills the agent; comments while Backlog'd are ignored. Resume by moving back to Planning.
- Waiting for a blocked agent in the terminal — all communication is Linear comments (or dashboard chat).
- Releasing a dependent issue before the prerequisite's PR is merged — the new worktree won't contain the unmerged code.

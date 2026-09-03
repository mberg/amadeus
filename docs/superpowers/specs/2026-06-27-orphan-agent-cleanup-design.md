# Orphaned agent-process cleanup — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Branch:** `feat/orphan-agent-cleanup`

## Problem

Amadeus spawns one `agentapi server claude --port N` child process per agent. When
the Amadeus server restarts or crashes, those children keep running — they are not
killed, and the orchestrator's in-memory tracking map is lost. Over time orphaned
`agentapi` processes accumulate, each holding a TCP port and (in observed cases)
burning runaway CPU.

Port allocation is a naive `nextPort++` starting at `8001` with **no free-port
check** (`src/orchestrator.ts:89,433`). Once an orphan squats on a port in that
range, every new agent that lands on that port fails to bind:

```
listen tcp :8010: bind: address already in use
[Agent] Agent ... died unexpectedly with exit code 1
Failed to spawn agent for REC-497
```

This was observed on 2026-06-27: ~17 orphaned `agentapi` processes (some weeks old,
2000+ CPU-minutes each) occupied ports 8003–8147 and silently blocked all new agent
spawns. Manual cleanup (kill + restart) restored service, but the failure recurs.

### Relevant current architecture (file:line)

- **Port allocation:** `src/orchestrator.ts:89` (`nextPort = 8001`), `:433`
  (`const port = this.nextPort++`) — sequential, unbounded, unchecked.
- **Spawn:** `src/orchestrator.ts:493-508` — `Bun.spawn(...)`, no process group, no
  parent-death handling.
- **Tracking:** `src/orchestrator.ts:510-525` — in-memory `this.agents` Map
  (`AgentInstance` includes `process`, `pid`, `port`); lost on restart.
- **Kill:** `src/orchestrator.ts:866` — `agent.process.kill()`, no SIGTERM→SIGKILL
  escalation, does not target the `claude` child.
- **HealthMonitor:** `src/health-monitor.ts:142-178` — HTTP GET `/status` per agent
  every 30s; marks dead in persistence, **does not kill processes**.
- **OrchestratorAgent:** `src/orchestrator-agent.ts:159-324` — Linear reconciliation
  every 60s; stops *tracked* agents on terminal issue state.
- **Persistence:** `src/persistence.ts:43-59` — SQLite `agents` table with `port`,
  `status`; **no PID column**.
- **Startup:** `src/server.ts:62-192` — initializes components; **no orphan cleanup
  or agent recovery**.
- **Config:** `src/config-schema.ts` — no agent port-range option.

## Goal

Prevent orphaned `agentapi` processes from accumulating and blocking new spawns —
**without ever killing a legitimately working agent.**

## Design principles

1. **Correctness must not depend on killing.** The spawn-time port probe fixes the
   actual failure (bind errors) with zero kill risk. Killing only prevents *leaks*,
   so every kill path can afford to be conservative.
2. **Structural safety over heuristics.** The watchdog reaps only processes that are
   not in the orchestrator's tracked map — it is structurally impossible to reap a
   live, managed agent. No CPU/age guessing about what is "stuck."
3. **Tight blast radius.** A reap candidate must match *both* the command pattern
   `agentapi server claude` *and* a port within the configured range.

## Components

### 1. Spawn-time port probe (fixes the bug; zero kill risk)

In `orchestrator.ts`, replace the bare `this.nextPort++` with a bounded search:

- Probe the candidate port (TCP connect / `fetch` to `http://localhost:{port}/status`
  with ~500ms timeout). If something answers, the port is occupied → advance.
- Search within `[agentPortStart, agentPortEnd]`. Wrap/scan from the current cursor.
- If no free port exists in range, fail the spawn with a clear, logged error rather
  than colliding.

Outcome: "address already in use" can no longer fail a spawn, regardless of orphans.

### 2. `reapOrphans()` — one function, two callers

A single function used by both the startup sweep and the periodic watchdog.

1. **Enumerate** processes matching `agentapi server claude --port N` **and** with
   `N` inside `[agentPortStart, agentPortEnd]`. (Both conditions required.)
2. **Exclude** any process in the orchestrator's tracked-agent set. Agents enter the
   tracked map synchronously immediately after `spawn()` (no `await` between
   `orchestrator.ts:493` and `:510`), so the tracked-port filter already covers the
   spawn race — no separate time-based grace window is needed.
3. **Conservative gate** — for each remaining candidate, kill only if:
   - it is **unresponsive** on `/status`, **or**
   - its Linear issue is in a **terminal state** (done / closed / cancelled /
     duplicate), resolved from the persisted `linearState` for that port.

   A responsive + active candidate is **spared** and logged. (The port probe means
   spared orphans cannot block new spawns anyway.)
4. **Kill** via **tree-kill**: `pkill -TERM -P <pid>` (children) + `process.kill(pid,
   SIGTERM)` → wait ~5s → `pkill -KILL -P <pid>` + `process.kill(pid, SIGKILL)`. This
   reaps the child `claude` together with its `agentapi` parent. `pkill -P` is chosen
   over process groups / `setsid` because `setsid` is unavailable on macOS, and
   tree-kill also works on orphans spawned by older code (no spawn-path change
   required).

### 3. Callers + shutdown hook

- **Startup:** call `reapOrphans()` once after the orchestrator initializes. The
  tracked map is empty, so this clears previous-run leftovers — conservatively
  (responsive+active survivors are spared).
- **Watchdog:** call `reapOrphans()` on an interval (alongside the existing
  `HealthMonitor` loop). Steady-state, the tracked map is populated, so only true
  orphans are candidates.
- **Graceful shutdown:** a `SIGTERM`/`SIGINT` handler kills all *tracked* agents'
  process groups before exit — prevents creating orphans on every restart.

## Configuration (new, in `config-schema.ts`, all optional with defaults)

| Key | Default | Meaning |
|-----|---------|---------|
| `agentPortStart` | `8001` | Inclusive lower bound of the agent port range |
| `agentPortEnd` | `8999` | Inclusive upper bound of the agent port range |
| `orphanReapIntervalMs` | `30000` | Watchdog cadence |

## Data flow

```
spawn:    findFreePort(range) → spawn agentapi → track in map (pid, port)
startup:  reapOrphans()  [map empty → previous-run leftovers, conservatively reaped]
watchdog: reapOrphans()  [every orphanReapIntervalMs; only untracked candidates]
shutdown: SIGTERM/SIGINT → tree-kill (pkill -P) every tracked agent → exit
```

## Error handling

- Port-probe timeout/refusal is treated as "port free / occupied" respectively; any
  unexpected probe error is logged and the port is treated as occupied (skip it).
- Process enumeration or kill failures are caught per-process and logged; one bad
  process never aborts the whole reap pass.
- `kill(-pid, …)` on an already-dead group is a no-op (ESRCH caught and ignored).
- Range exhaustion on spawn is a loud, logged failure (no silent collision).

## Observability

Every reap pass logs: candidates found, each spared decision with reason
(tracked / within-grace / responsive+active), and each kill with reason
(unresponsive / terminal issue). The goal: the log alone explains the system's
behavior, so a future incident is diagnosable without manually listing processes.

## Testing

- **Pure decision logic** `shouldReap(process, trackedSet, now, issueState)` —
  table-driven: untracked+unresponsive → kill; untracked+responsive+active → spare;
  tracked → spare; within grace → spare; terminal issue → kill.
- **Port probe** — tested against a real bound port (Bun `listen` on a throwaway
  port) to confirm occupied vs. free detection.
- **Isolation** — process *enumeration* and *killing* sit behind a thin injectable
  interface so unit tests do not shell out or kill real processes.

## Out of scope (YAGNI)

- **Runaway-CPU auto-killer** — too risky (cannot distinguish stuck from busy). The
  watchdog only *logs a warning* for tracked agents that look runaway.
- **PID-persistence column** — the live process table is ground truth; pre-existing
  orphans need no prior record.
- **Re-adoption of orphaned agents into management** — conservative-spare was chosen
  over re-adopt; spared orphans run until they finish or go terminal.

## Affected files (anticipated)

- `src/orchestrator.ts` — free-port probe allocation, `getTrackedPorts()`, tree-kill
  on stop via an injected `ProcessInspector`.
- `src/server.ts` — startup reap call, watchdog interval, SIGTERM/SIGINT handler.
- `src/config-schema.ts` — new config keys + defaults.
- New: `src/port-utils.ts` (free-port probing), `src/process-inspector.ts`
  (enumerate/tree-kill behind an interface), `src/orphan-reaper.ts` (decision +
  orchestration) + their tests.

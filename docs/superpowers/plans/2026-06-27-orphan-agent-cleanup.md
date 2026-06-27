# Orphaned agent-process cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop orphaned `agentapi server claude` processes from accumulating and blocking new agent spawns, without ever killing a legitimately working agent.

**Architecture:** A spawn-time free-port probe makes "address already in use" impossible (zero kill risk). A `reapOrphans()` function — called once at startup and on a watchdog interval — enumerates `agentapi` processes in the configured port range, subtracts the orchestrator's tracked agents, and kills only the ones that are unresponsive or whose Linear issue is terminal. A SIGTERM/SIGINT handler tears down tracked agents on shutdown so restarts don't create orphans. All process killing uses `pkill -P` tree-kill so the child `claude` dies with its `agentapi` parent (works on macOS and Linux, and on orphans spawned by older code).

**Tech Stack:** Bun (runtime, test runner, `Bun.$` shell, `Bun.spawn`), TypeScript, Zod (config schema).

## Global Constraints

- Runtime/tooling is Bun: `bun test`, `Bun.$`, `Bun.spawn`, `Bun.sleep`. No Node-only APIs, no `node:child_process`.
- Every source file starts with two `// ABOUTME:` comment lines (existing convention).
- Tests live next to source as `src/<name>.test.ts` and import from `bun:test`.
- Process killing must be cross-platform (macOS + Linux): use `pkill -P <pid>` for children, `process.kill(pid, sig)` for the parent. Do NOT use `setsid` or process groups (`kill(-pid)`).
- Reap candidate match requires BOTH conditions: command contains `agentapi` + `server`, AND `--port N` with N inside `[agentPortStart, agentPortEnd]`.
- Default port range: `agentPortStart=8001`, `agentPortEnd=8999`. Default watchdog cadence: `orphanReapIntervalMs=30000`.
- Conservative kill gate: kill only if the process is unresponsive on `/status` OR its Linear issue is in a terminal state. Spare everything else (especially responsive + active).

---

### Task 1: Config keys for port range and reap cadence

**Files:**
- Modify: `src/config-schema.ts:122-153` (`GlobalConfigSchema`)
- Test: `src/config-schema.test.ts`

**Interfaces:**
- Produces: three new optional `GlobalConfig` fields with defaults — `agentPortStart: number` (8001), `agentPortEnd: number` (8999), `orphanReapIntervalMs: number` (30000).

- [ ] **Step 1: Write the failing test**

Add to `src/config-schema.test.ts`:

```ts
import { test, expect } from "bun:test";
import { GlobalConfigSchema } from "./config-schema";

test("GlobalConfig provides orphan-cleanup defaults", () => {
  const cfg = GlobalConfigSchema.parse({});
  expect(cfg.agentPortStart).toBe(8001);
  expect(cfg.agentPortEnd).toBe(8999);
  expect(cfg.orphanReapIntervalMs).toBe(30000);
});

test("GlobalConfig accepts custom orphan-cleanup values", () => {
  const cfg = GlobalConfigSchema.parse({
    agentPortStart: 9000,
    agentPortEnd: 9100,
    orphanReapIntervalMs: 15000,
  });
  expect(cfg.agentPortStart).toBe(9000);
  expect(cfg.agentPortEnd).toBe(9100);
  expect(cfg.orphanReapIntervalMs).toBe(15000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/config-schema.test.ts`
Expected: FAIL — `expect(received).toBe(8001)` received `undefined`.

- [ ] **Step 3: Add the fields**

In `src/config-schema.ts`, inside `GlobalConfigSchema` (after the `healthCheckTimeoutMs` line at `:133`):

```ts
  agentPortStart: z.number().int().positive().default(8001),
  agentPortEnd: z.number().int().positive().default(8999),
  orphanReapIntervalMs: z.number().int().positive().default(30000),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/config-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config-schema.ts src/config-schema.test.ts
git commit -m "feat: add agent port-range and orphan-reap config keys"
```

---

### Task 2: Free-port utilities

**Files:**
- Create: `src/port-utils.ts`
- Test: `src/port-utils.test.ts`

**Interfaces:**
- Produces:
  - `type PortProbe = (port: number) => Promise<boolean>` — resolves `true` if the port is occupied.
  - `isPortOccupied(port: number, timeoutMs?: number): Promise<boolean>` — real probe via `fetch` to `/status`.
  - `findFreePort(opts: { from: number; start: number; end: number; probe: PortProbe }): Promise<number>` — scans `[from..end]` then wraps `[start..from)`, returns the first free port, throws if none.

- [ ] **Step 1: Write the failing test**

Create `src/port-utils.test.ts`:

```ts
// ABOUTME: Tests for agent port probing and free-port selection.
// ABOUTME: Covers findFreePort scan/wrap logic and isPortOccupied against a real port.

import { test, expect } from "bun:test";
import { findFreePort, isPortOccupied } from "./port-utils";

test("findFreePort returns first free port at or after `from`", async () => {
  const occupied = new Set([8001, 8002, 8003]);
  const probe = async (p: number) => occupied.has(p);
  const port = await findFreePort({ from: 8001, start: 8001, end: 8999, probe });
  expect(port).toBe(8004);
});

test("findFreePort wraps to the start of the range when tail is full", async () => {
  const occupied = new Set([8005, 8006, 8007, 8008, 8009]);
  const probe = async (p: number) => occupied.has(p);
  // from=8005, end=8009 all occupied -> wrap and find 8001
  const port = await findFreePort({ from: 8005, start: 8001, end: 8009, probe });
  expect(port).toBe(8001);
});

test("findFreePort throws when the whole range is occupied", async () => {
  const probe = async () => true;
  await expect(
    findFreePort({ from: 8001, start: 8001, end: 8003, probe })
  ).rejects.toThrow(/No free agent port/);
});

test("isPortOccupied is true for a port with a live listener", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  try {
    expect(await isPortOccupied(server.port)).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("isPortOccupied is false for a closed port", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  server.stop(true);
  expect(await isPortOccupied(port, 300)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/port-utils.test.ts`
Expected: FAIL — cannot find module `./port-utils`.

- [ ] **Step 3: Implement the module**

Create `src/port-utils.ts`:

```ts
// ABOUTME: Utilities for probing agent ports and selecting a free one.
// ABOUTME: Used by the orchestrator to avoid binding to occupied ports.

export type PortProbe = (port: number) => Promise<boolean>;

/**
 * Returns true if something is listening on the port (any HTTP response
 * to /status counts). A connection refusal or timeout is treated as free.
 */
export async function isPortOccupied(port: number, timeoutMs = 500): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scans [from..end] then wraps to [start..from) and returns the first port
 * the probe reports as free. Throws if every port in the range is occupied.
 */
export async function findFreePort(opts: {
  from: number;
  start: number;
  end: number;
  probe: PortProbe;
}): Promise<number> {
  const { start, end, probe } = opts;
  const from = Math.max(opts.from, start);
  for (let p = from; p <= end; p++) {
    if (!(await probe(p))) return p;
  }
  for (let p = start; p < from; p++) {
    if (!(await probe(p))) return p;
  }
  throw new Error(`No free agent port in range ${start}-${end}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/port-utils.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/port-utils.ts src/port-utils.test.ts
git commit -m "feat: add free-port probing utilities"
```

---

### Task 3: Process inspector (enumerate + tree-kill agentapi processes)

**Files:**
- Create: `src/process-inspector.ts`
- Test: `src/process-inspector.test.ts`

**Interfaces:**
- Produces:
  - `interface AgentApiProcess { pid: number; port: number; command: string }`
  - `interface ProcessInspector { list(): Promise<AgentApiProcess[]>; killTree(pid: number): Promise<void> }`
  - `parseAgentApiProcesses(psOutput: string): AgentApiProcess[]` — pure parser.
  - `class RealProcessInspector implements ProcessInspector` — `list()` shells `ps`, `killTree()` uses `pkill -P` + `process.kill`.

- [ ] **Step 1: Write the failing test**

Create `src/process-inspector.test.ts`:

```ts
// ABOUTME: Tests for parsing `ps` output into agentapi process records.
// ABOUTME: Killing is exercised via the injectable ProcessInspector interface elsewhere.

import { test, expect } from "bun:test";
import { parseAgentApiProcesses } from "./process-inspector";

const PS = [
  "  101 agentapi server claude --port 8003 -- --dangerously-skip-permissions",
  "  102 agentapi server codex --port 8004 -- --dangerously-bypass-approvals-and-sandbox",
  "  103 /bin/zsh -c something unrelated",
  "  104 claude --dangerously-skip-permissions",
  "  105 agentapi server claude --port notaport",
].join("\n");

test("parses pid and port from agentapi server lines", () => {
  const procs = parseAgentApiProcesses(PS);
  expect(procs).toEqual([
    { pid: 101, port: 8003, command: "agentapi server claude --port 8003 -- --dangerously-skip-permissions" },
    { pid: 102, port: 8004, command: "agentapi server codex --port 8004 -- --dangerously-bypass-approvals-and-sandbox" },
  ]);
});

test("ignores non-agentapi lines and lines without a numeric port", () => {
  const procs = parseAgentApiProcesses(PS);
  expect(procs.map((p) => p.pid)).not.toContain(103);
  expect(procs.map((p) => p.pid)).not.toContain(104);
  expect(procs.map((p) => p.pid)).not.toContain(105);
});

test("returns empty array for empty input", () => {
  expect(parseAgentApiProcesses("")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/process-inspector.test.ts`
Expected: FAIL — cannot find module `./process-inspector`.

- [ ] **Step 3: Implement the module**

Create `src/process-inspector.ts`:

```ts
// ABOUTME: Enumerates and kills agentapi agent processes.
// ABOUTME: Parsing is pure/testable; killing uses pkill -P for cross-platform tree-kill.

import { $ } from "bun";

export interface AgentApiProcess {
  pid: number;
  port: number;
  command: string;
}

export interface ProcessInspector {
  list(): Promise<AgentApiProcess[]>;
  killTree(pid: number): Promise<void>;
}

/**
 * Pure parser. Expects each line as "<pid> <command...>".
 * Keeps only lines that are an agentapi server with a numeric --port.
 */
export function parseAgentApiProcesses(psOutput: string): AgentApiProcess[] {
  const out: AgentApiProcess[] = [];
  for (const raw of psOutput.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes("agentapi") || !line.includes("server")) continue;
    const portMatch = line.match(/--port\s+(\d+)\b/);
    if (!portMatch) continue;
    const fields = line.split(/\s+/);
    const pid = Number(fields[0]);
    if (!Number.isFinite(pid)) continue;
    out.push({
      pid,
      port: Number(portMatch[1]),
      command: fields.slice(1).join(" "),
    });
  }
  return out;
}

export class RealProcessInspector implements ProcessInspector {
  async list(): Promise<AgentApiProcess[]> {
    const output = await $`ps -axo pid=,command=`.text();
    return parseAgentApiProcesses(output);
  }

  /** SIGTERM the process and its direct children, wait, then SIGKILL the stragglers. */
  async killTree(pid: number): Promise<void> {
    await $`pkill -TERM -P ${pid}`.nothrow().quiet();
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    await Bun.sleep(5000);
    await $`pkill -KILL -P ${pid}`.nothrow().quiet();
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/process-inspector.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/process-inspector.ts src/process-inspector.test.ts
git commit -m "feat: add process inspector for enumerating/killing agentapi"
```

---

### Task 4: Reap decision logic + orchestration

**Files:**
- Create: `src/orphan-reaper.ts`
- Test: `src/orphan-reaper.test.ts`

**Interfaces:**
- Consumes: `ProcessInspector`, `AgentApiProcess` from `./process-inspector` (Task 3).
- Produces:
  - `interface ReapDecision { reap: boolean; reason: string }`
  - `shouldReap(input: { candidate: AgentApiProcess; trackedPorts: Set<number>; responsive: boolean; issueTerminal: boolean }): ReapDecision`
  - `interface ReapResult { killed: number[]; spared: number[] }`
  - `interface ReapDeps { inspector: ProcessInspector; getTrackedPorts: () => Set<number>; isResponsive: (port: number) => Promise<boolean>; isIssueTerminal: (port: number) => Promise<boolean>; log?: (msg: string) => void }`
  - `reapOrphans(deps: ReapDeps): Promise<ReapResult>`

- [ ] **Step 1: Write the failing test**

Create `src/orphan-reaper.test.ts`:

```ts
// ABOUTME: Tests for the conservative orphan-reap decision and orchestration.
// ABOUTME: shouldReap is table-driven; reapOrphans runs against fake deps.

import { test, expect } from "bun:test";
import { shouldReap, reapOrphans } from "./orphan-reaper";
import type { ProcessInspector, AgentApiProcess } from "./process-inspector";

const cand = (pid: number, port: number): AgentApiProcess => ({
  pid,
  port,
  command: `agentapi server claude --port ${port}`,
});

test("shouldReap spares tracked ports regardless of responsiveness", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set([8003]),
    responsive: false,
    issueTerminal: true,
  });
  expect(d).toEqual({ reap: false, reason: "tracked" });
});

test("shouldReap reaps untracked unresponsive process", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set(),
    responsive: false,
    issueTerminal: false,
  });
  expect(d).toEqual({ reap: true, reason: "unresponsive" });
});

test("shouldReap reaps untracked responsive process whose issue is terminal", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set(),
    responsive: true,
    issueTerminal: true,
  });
  expect(d).toEqual({ reap: true, reason: "issue-terminal" });
});

test("shouldReap spares untracked responsive process with active issue", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set(),
    responsive: true,
    issueTerminal: false,
  });
  expect(d).toEqual({ reap: false, reason: "responsive-active" });
});

test("reapOrphans kills only the orphans that fail the gate", async () => {
  const killed: number[] = [];
  const inspector: ProcessInspector = {
    list: async () => [cand(101, 8003), cand(102, 8004), cand(103, 8005)],
    killTree: async (pid) => {
      killed.push(pid);
    },
  };
  const result = await reapOrphans({
    inspector,
    getTrackedPorts: () => new Set([8005]), // 8005 tracked -> spared
    isResponsive: async (port) => port === 8004, // 8003 dead -> reap; 8004 alive
    isIssueTerminal: async () => false, // 8004 active -> spared
    log: () => {},
  });
  expect(killed).toEqual([101]);
  expect(result.killed).toEqual([101]);
  expect(result.spared.sort()).toEqual([8004, 8005]);
});

test("reapOrphans continues past a killTree failure", async () => {
  const killed: number[] = [];
  const inspector: ProcessInspector = {
    list: async () => [cand(101, 8003), cand(102, 8006)],
    killTree: async (pid) => {
      if (pid === 101) throw new Error("boom");
      killed.push(pid);
    },
  };
  const result = await reapOrphans({
    inspector,
    getTrackedPorts: () => new Set(),
    isResponsive: async () => false,
    isIssueTerminal: async () => false,
    log: () => {},
  });
  expect(killed).toEqual([102]);
  expect(result.killed).toEqual([102]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/orphan-reaper.test.ts`
Expected: FAIL — cannot find module `./orphan-reaper`.

- [ ] **Step 3: Implement the module**

Create `src/orphan-reaper.ts`:

```ts
// ABOUTME: Conservative reaping of orphaned agentapi processes.
// ABOUTME: Kills only untracked processes that are unresponsive or whose issue is terminal.

import type { ProcessInspector, AgentApiProcess } from "./process-inspector";

export interface ReapDecision {
  reap: boolean;
  reason: string;
}

export function shouldReap(input: {
  candidate: AgentApiProcess;
  trackedPorts: Set<number>;
  responsive: boolean;
  issueTerminal: boolean;
}): ReapDecision {
  const { candidate, trackedPorts, responsive, issueTerminal } = input;
  if (trackedPorts.has(candidate.port)) {
    return { reap: false, reason: "tracked" };
  }
  if (!responsive) {
    return { reap: true, reason: "unresponsive" };
  }
  if (issueTerminal) {
    return { reap: true, reason: "issue-terminal" };
  }
  return { reap: false, reason: "responsive-active" };
}

export interface ReapResult {
  killed: number[];
  spared: number[];
}

export interface ReapDeps {
  inspector: ProcessInspector;
  getTrackedPorts: () => Set<number>;
  isResponsive: (port: number) => Promise<boolean>;
  isIssueTerminal: (port: number) => Promise<boolean>;
  log?: (msg: string) => void;
}

export async function reapOrphans(deps: ReapDeps): Promise<ReapResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const candidates = await deps.inspector.list();
  const tracked = deps.getTrackedPorts();
  const killed: number[] = [];
  const spared: number[] = [];

  for (const c of candidates) {
    if (tracked.has(c.port)) {
      spared.push(c.port);
      continue;
    }
    const responsive = await deps.isResponsive(c.port);
    const issueTerminal = responsive ? await deps.isIssueTerminal(c.port) : false;
    const decision = shouldReap({ candidate: c, trackedPorts: tracked, responsive, issueTerminal });

    if (decision.reap) {
      log(`[OrphanReaper] Killing orphan pid=${c.pid} port=${c.port} (${decision.reason})`);
      try {
        await deps.inspector.killTree(c.pid);
        killed.push(c.pid);
      } catch (err) {
        log(`[OrphanReaper] Failed to kill pid=${c.pid}: ${err}`);
      }
    } else {
      log(`[OrphanReaper] Sparing pid=${c.pid} port=${c.port} (${decision.reason})`);
      spared.push(c.port);
    }
  }

  log(`[OrphanReaper] Reap pass complete: ${killed.length} killed, ${spared.length} spared`);
  return { killed, spared };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/orphan-reaper.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orphan-reaper.ts src/orphan-reaper.test.ts
git commit -m "feat: add conservative orphan-reaper logic"
```

---

### Task 5: Wire free-port allocation into the orchestrator

**Files:**
- Modify: `src/orchestrator.ts` (imports; `OrchestratorConfig` at `:39-54`; fields at `:89`; spawn site at `:433`; add `allocatePort` and `getTrackedPorts` methods)
- Test: `src/orchestrator.test.ts` (create if absent)

**Interfaces:**
- Consumes: `findFreePort`, `isPortOccupied` from `./port-utils` (Task 2).
- Produces on `ClaudeOrchestrator`:
  - `getTrackedPorts(): Set<number>` — ports of all currently tracked agents.
  - `OrchestratorConfig` gains optional `agentPortStart?: number`, `agentPortEnd?: number`.

- [ ] **Step 1: Write the failing test**

Create/append `src/orchestrator.test.ts`:

```ts
// ABOUTME: Tests for orchestrator port tracking used by the orphan reaper.

import { test, expect } from "bun:test";
import { ClaudeOrchestrator } from "./orchestrator";

test("getTrackedPorts returns empty set with no agents", () => {
  const orch = new ClaudeOrchestrator({
    projectPaths: {},
    triggerStates: ["Planning"],
  });
  expect(orch.getTrackedPorts()).toEqual(new Set());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/orchestrator.test.ts`
Expected: FAIL — `getTrackedPorts is not a function`.

- [ ] **Step 3: Implement**

In `src/orchestrator.ts`:

3a. Add import near the top (after the `./linear` import at `:16`):

```ts
import { findFreePort, isPortOccupied } from "./port-utils";
```

3b. Add two optional fields to `OrchestratorConfig` (inside the interface at `:39-54`):

```ts
  agentPortStart?: number;
  agentPortEnd?: number;
```

3c. Replace the `private nextPort = 8001;` field (`:89`) with:

```ts
  private nextPort: number;
  private readonly portStart: number;
  private readonly portEnd: number;
```

3d. In the constructor (`:97-99`), set them from config:

```ts
  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.portStart = config.agentPortStart ?? 8001;
    this.portEnd = config.agentPortEnd ?? 8999;
    this.nextPort = this.portStart;
  }
```

3e. Replace the allocation line `const port = this.nextPort++;` (`:433`) with:

```ts
    const port = await this.allocatePort();
```

3f. Add these two methods to the class (e.g. just before `stopAgent` at `:843`):

```ts
  getTrackedPorts(): Set<number> {
    return new Set(Array.from(this.agents.values()).map((a) => a.port));
  }

  private async allocatePort(): Promise<number> {
    const port = await findFreePort({
      from: this.nextPort,
      start: this.portStart,
      end: this.portEnd,
      probe: (p) => isPortOccupied(p),
    });
    this.nextPort = port + 1 > this.portEnd ? this.portStart : port + 1;
    return port;
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/orchestrator.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit`
Expected: no new errors in `src/orchestrator.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts
git commit -m "feat: allocate agent ports by probing for a free one"
```

---

### Task 6: Use tree-kill when stopping tracked agents

**Files:**
- Modify: `src/orchestrator.ts` — `stopAgent` at `:866`; constructor/config for an injectable killer.
- Test: `src/orchestrator.test.ts`

**Interfaces:**
- Consumes: `ProcessInspector` from `./process-inspector` (Task 3).
- Produces on `OrchestratorConfig`: optional `processInspector?: ProcessInspector`. When present, `stopAgent` kills the whole tree (agentapi + `claude` child) by pid; otherwise it falls back to `agent.process.kill()`.

- [ ] **Step 1: Write the failing test**

Append to `src/orchestrator.test.ts`:

```ts
import type { ProcessInspector } from "./process-inspector";

test("orchestrator exposes the injected process inspector for teardown", () => {
  const calls: number[] = [];
  const inspector: ProcessInspector = {
    list: async () => [],
    killTree: async (pid) => {
      calls.push(pid);
    },
  };
  const orch = new ClaudeOrchestrator({
    projectPaths: {},
    triggerStates: ["Planning"],
    processInspector: inspector,
  });
  // killTrackedAgent is a thin wrapper used by stopAgent and shutdown.
  orch.killTrackedAgent(4242);
  expect(calls).toEqual([4242]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/orchestrator.test.ts`
Expected: FAIL — `killTrackedAgent is not a function` (and `processInspector` not in config type).

- [ ] **Step 3: Implement**

3a. Add to `OrchestratorConfig` (interface at `:39-54`):

```ts
  processInspector?: ProcessInspector;
```

3b. Add the import (after the `./port-utils` import from Task 5):

```ts
import type { ProcessInspector } from "./process-inspector";
```

3c. Add a public helper method to the class (near `getTrackedPorts`):

```ts
  /** Kill an agent process tree (agentapi + child) by pid, if an inspector is configured. */
  killTrackedAgent(pid: number): void {
    if (this.config.processInspector) {
      void this.config.processInspector.killTree(pid).catch((err) => {
        console.warn(`[Agent] killTree(${pid}) failed: ${err}`);
      });
    }
  }
```

3d. In `stopAgent`, replace `agent.process.kill();` (`:866`) with:

```ts
    if (this.config.processInspector && agent.pid) {
      this.config.processInspector.killTree(agent.pid).catch((err) => {
        console.warn(`[Agent] killTree(${agent.pid}) failed: ${err}`);
      });
    } else {
      agent.process.kill();
    }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/orchestrator.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts
git commit -m "feat: tree-kill agent process trees on stop"
```

---

### Task 7: Server wiring — startup sweep, watchdog, graceful shutdown

**Files:**
- Modify: `src/server.ts` — orchestrator construction (`:115-134`), and add wiring after the health monitor block (`:162`).

**Interfaces:**
- Consumes: `RealProcessInspector` (Task 3), `reapOrphans` + `ReapDeps` (Task 4), `isPortOccupied` (Task 2), `orchestrator.getTrackedPorts()` / `killTrackedAgent()` (Tasks 5-6), `CONFIG.agentPortStart/agentPortEnd/orphanReapIntervalMs/orchestratorAgent.terminalStates`, `persistence.getAllAgents()`.

This task is integration glue verified by typecheck, a clean boot, and a real reap; the pure logic it composes is already unit-tested in Tasks 2-6.

- [ ] **Step 1: Add imports** (top of `src/server.ts`, with the other local imports)

```ts
import { RealProcessInspector } from "./process-inspector";
import { reapOrphans, type ReapDeps } from "./orphan-reaper";
import { isPortOccupied } from "./port-utils";
```

- [ ] **Step 2: Pass port range + inspector into the orchestrator**

In the `new ClaudeOrchestrator({ ... })` call (`:115-134`), add these properties:

```ts
    agentPortStart: CONFIG.agentPortStart,
    agentPortEnd: CONFIG.agentPortEnd,
    processInspector: new RealProcessInspector(),
```

- [ ] **Step 3: Add the reap wiring** (immediately after `healthMonitor.start();` at `:161`, inside the same machine/standalone block)

```ts
  // Orphaned-process cleanup: clear leftovers at startup, then on an interval.
  const reapInspector = new RealProcessInspector();
  const terminalStates = new Set(
    (CONFIG.orchestratorAgent?.terminalStates ?? []).map((s) => s.toLowerCase())
  );
  const reapDeps: ReapDeps = {
    inspector: reapInspector,
    getTrackedPorts: () => orchestrator!.getTrackedPorts(),
    isResponsive: (port) => isPortOccupied(port),
    isIssueTerminal: async (port) => {
      const rec = persistence!.getAllAgents().find((a) => a.port === port);
      return rec?.linearState ? terminalStates.has(rec.linearState.toLowerCase()) : false;
    },
  };

  // Startup sweep (tracked map is empty -> previous-run leftovers, conservatively reaped).
  reapOrphans(reapDeps).catch((err) =>
    console.error("[OrphanReaper] Startup reap failed:", err)
  );

  // Watchdog.
  setInterval(() => {
    reapOrphans(reapDeps).catch((err) =>
      console.error("[OrphanReaper] Watchdog reap failed:", err)
    );
  }, CONFIG.orphanReapIntervalMs);
  console.log(`[OrphanReaper] Watchdog enabled (every ${CONFIG.orphanReapIntervalMs}ms)`);
```

- [ ] **Step 4: Add graceful shutdown** (after the reap wiring)

```ts
  const shutdown = (signal: string) => {
    console.log(`[Server] ${signal} received — tearing down tracked agents`);
    for (const status of orchestrator!.getStatus()) {
      if (status.pid) orchestrator!.killTrackedAgent(status.pid);
    }
    setTimeout(() => process.exit(0), 1000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Full test suite**

Run: `bun test`
Expected: PASS (all existing tests + the new ones from Tasks 1-6).

- [ ] **Step 7: Manual smoke test**

```bash
# Boot the server; confirm the watchdog log line and a clean startup reap.
bun run dev >> /tmp/amadeus-verify.log 2>&1 &
sleep 8
grep -E "OrphanReaper|listening on" /tmp/amadeus-verify.log
```

Expected: `[OrphanReaper] Watchdog enabled (every 30000ms)`, a `[OrphanReaper] Reap pass complete: ...` line, and `🎼 Amadeus listening on http://localhost:5678`.

To exercise an actual reap: start a fake orphan, then confirm it gets killed within one interval.

```bash
# Fake orphan on a port in range that answers nothing useful (unresponsive /status).
# Use a bare TCP listener so /status fails -> classified unresponsive -> reaped.
( exec -a "agentapi server claude --port 8201 -- --dangerously-skip-permissions" sleep 600 ) &
sleep 35
ps ax | grep "[a]gentapi server claude --port 8201" || echo "orphan reaped as expected"
```

Expected: the fake orphan is gone, with a `[OrphanReaper] Killing orphan ... (unresponsive)` line in the log.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts
git commit -m "feat: startup sweep, watchdog, and graceful shutdown for orphaned agents"
```

---

## Self-Review notes

- **Spec coverage:** spawn-time port probe (Tasks 2, 5); `reapOrphans` one-function/two-callers (Tasks 4, 7); conservative gate / unresponsive-or-terminal (Task 4 `shouldReap`, Task 7 resolvers); tree-kill of child `claude` (Task 3 `killTree`, Task 6 stopAgent); startup sweep + watchdog + graceful shutdown (Task 7); config range + cadence (Task 1); observability logging (Task 4); tests isolating enumeration/killing behind `ProcessInspector` (Tasks 3-4).
- **Deviations from the design doc (both make it safer/simpler, reconciled in the spec):**
  1. Killing uses `pkill -P` tree-kill instead of `setsid`/process groups — `setsid` is unavailable on macOS, and tree-kill also reaps orphans spawned by older code. No spawn-path change is therefore needed.
  2. `orphanGraceMs` is dropped — agents enter the tracked map synchronously right after `spawn()` (no `await` between `:493` and `:510`), so the tracked-port filter already covers the spawn race. One fewer config knob.
- **Type consistency:** `ProcessInspector`/`AgentApiProcess` defined in Task 3 are consumed unchanged in Tasks 4, 6, 7. `getTrackedPorts`/`killTrackedAgent` defined in Tasks 5-6 are consumed in Task 7. `ReapDeps` shape in Task 4 matches the object built in Task 7.

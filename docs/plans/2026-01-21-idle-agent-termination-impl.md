# Idle Agent Termination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-terminate agents stuck in idle states (e.g., "Needs Feedback") to let sprites hibernate and save costs.

**Architecture:** Hub-side scanner checks heartbeat data for agents in configurable idle states. After timeout (default 15 min), sends stop command via existing proxy. Uses registry to track when each agent entered idle state.

**Tech Stack:** TypeScript, Bun, Zod (config validation)

---

### Task 1: Add Config Schema for Idle Termination

**Files:**
- Modify: `src/config-schema.ts`

**Step 1: Write the idle termination config schema**

Add after `StaticMachineSchema` (around line 86):

```typescript
/**
 * Schema for idle agent termination settings.
 */
export const IdleTerminationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMinutes: z.number().int().positive().default(15),
  idleStates: z.array(z.string()).default(["Needs Feedback"]),
  scanIntervalSeconds: z.number().int().positive().default(60),
});

export type IdleTerminationConfig = z.infer<typeof IdleTerminationConfigSchema>;
```

**Step 2: Add to GlobalConfigSchema**

In `GlobalConfigSchema` (around line 107), add:

```typescript
  idleTermination: IdleTerminationConfigSchema.optional().default({
    enabled: true,
    timeoutMinutes: 15,
    idleStates: ["Needs Feedback"],
    scanIntervalSeconds: 60,
  }),
```

**Step 3: Run type check**

Run: `bun run tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/config-schema.ts
git commit -m "feat: add idle termination config schema"
```

---

### Task 2: Add Idle Tracking to Registry

**Files:**
- Modify: `src/hub/registry.ts`
- Modify: `src/hub/registry.test.ts`

**Step 1: Write failing test for idle tracking**

Add to `src/hub/registry.test.ts`:

```typescript
test("tracks agent idle start time", () => {
  registry.register("Frank", "http://frank.local:5678");

  // First heartbeat with idle state
  const agents = [{ key: "agent-1", linearState: "Needs Feedback" }] as any[];
  registry.updateStatus("Frank", "healthy", agents);

  const idleInfo = registry.getAgentIdleInfo("Frank", "agent-1");
  expect(idleInfo?.idleStartTime).toBeDefined();
  expect(idleInfo?.linearState).toBe("Needs Feedback");
});

test("clears idle time when agent leaves idle state", () => {
  registry.register("Frank", "http://frank.local:5678");

  // Start idle
  registry.updateStatus("Frank", "healthy", [
    { key: "agent-1", linearState: "Needs Feedback" } as any,
  ]);
  expect(registry.getAgentIdleInfo("Frank", "agent-1")?.idleStartTime).toBeDefined();

  // Leave idle state
  registry.updateStatus("Frank", "healthy", [
    { key: "agent-1", linearState: "In Progress" } as any,
  ]);
  expect(registry.getAgentIdleInfo("Frank", "agent-1")?.idleStartTime).toBeUndefined();
});

test("getIdleAgents returns agents idle longer than threshold", () => {
  registry.register("Frank", "http://frank.local:5678");

  registry.updateStatus("Frank", "healthy", [
    { key: "agent-1", linearState: "Needs Feedback" } as any,
  ]);

  // Manually backdate idle start time
  const info = registry.getAgentIdleInfo("Frank", "agent-1");
  if (info) {
    info.idleStartTime = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
  }

  const idleAgents = registry.getIdleAgents(["Needs Feedback"], 15 * 60 * 1000);
  expect(idleAgents.length).toBe(1);
  expect(idleAgents[0].agentKey).toBe("agent-1");
  expect(idleAgents[0].machineName).toBe("Frank");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/hub/registry.test.ts`
Expected: FAIL - methods don't exist

**Step 3: Implement idle tracking in registry**

Update `src/hub/registry.ts`:

```typescript
// Add after MachineInfo interface
export interface AgentIdleInfo {
  idleStartTime?: Date;
  linearState?: string;
}

export class MachineRegistry {
  private machines = new Map<string, MachineInfo>();
  private agentIdleTracking = new Map<string, AgentIdleInfo>(); // key: "machineName:agentKey"

  // ... existing methods ...

  /**
   * Update machine status from heartbeat.
   */
  updateStatus(name: string, status: MachineInfo["status"], agents?: AgentStatus[]): void {
    const machine = this.machines.get(name);
    if (machine) {
      machine.status = status;
      machine.agents = agents;
      machine.agentCount = agents?.length ?? 0;
      machine.lastHeartbeat = new Date();
      machine.lastSeen = new Date();

      // Track idle state for each agent
      if (agents) {
        for (const agent of agents) {
          this.trackAgentIdleState(name, agent.key, agent.linearState);
        }
      }
    }
  }

  private trackAgentIdleState(machineName: string, agentKey: string, linearState?: string): void {
    const trackingKey = `${machineName}:${agentKey}`;
    const existing = this.agentIdleTracking.get(trackingKey);

    if (linearState) {
      if (!existing?.idleStartTime || existing.linearState !== linearState) {
        // New idle state or state changed - reset timer
        this.agentIdleTracking.set(trackingKey, {
          idleStartTime: new Date(),
          linearState,
        });
      }
      // If same state, keep existing timer
    } else {
      // Not in any tracked state - clear
      this.agentIdleTracking.delete(trackingKey);
    }
  }

  /**
   * Get idle tracking info for an agent.
   */
  getAgentIdleInfo(machineName: string, agentKey: string): AgentIdleInfo | undefined {
    return this.agentIdleTracking.get(`${machineName}:${agentKey}`);
  }

  /**
   * Get all agents that have been idle longer than threshold.
   */
  getIdleAgents(idleStates: string[], thresholdMs: number): Array<{
    machineName: string;
    machineUrl: string;
    agentKey: string;
    linearState: string;
    idleDurationMs: number;
  }> {
    const now = Date.now();
    const results: Array<{
      machineName: string;
      machineUrl: string;
      agentKey: string;
      linearState: string;
      idleDurationMs: number;
    }> = [];

    for (const [trackingKey, info] of this.agentIdleTracking) {
      if (!info.idleStartTime || !info.linearState) continue;
      if (!idleStates.includes(info.linearState)) continue;

      const idleDurationMs = now - info.idleStartTime.getTime();
      if (idleDurationMs < thresholdMs) continue;

      const [machineName, agentKey] = trackingKey.split(":");
      const machine = this.machines.get(machineName);
      if (!machine) continue;

      results.push({
        machineName,
        machineUrl: machine.url,
        agentKey,
        linearState: info.linearState,
        idleDurationMs,
      });
    }

    return results;
  }

  /**
   * Remove idle tracking for an agent (after termination).
   */
  clearAgentIdleTracking(machineName: string, agentKey: string): void {
    this.agentIdleTracking.delete(`${machineName}:${agentKey}`);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/hub/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hub/registry.ts src/hub/registry.test.ts
git commit -m "feat: add idle tracking to machine registry"
```

---

### Task 3: Create IdleScanner Class

**Files:**
- Create: `src/hub/idle-scanner.ts`
- Create: `src/hub/idle-scanner.test.ts`

**Step 1: Write failing test for IdleScanner**

Create `src/hub/idle-scanner.test.ts`:

```typescript
// ABOUTME: Tests for the idle agent scanner.
// ABOUTME: Verifies detection and termination of idle agents.

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { IdleScanner } from "./idle-scanner";
import { MachineRegistry } from "./registry";

describe("IdleScanner", () => {
  let registry: MachineRegistry;
  let stopAgent: ReturnType<typeof mock>;
  let scanner: IdleScanner;

  beforeEach(() => {
    registry = new MachineRegistry();
    stopAgent = mock(() => Promise.resolve());
    scanner = new IdleScanner(
      {
        enabled: true,
        timeoutMinutes: 15,
        idleStates: ["Needs Feedback"],
        scanIntervalSeconds: 60,
      },
      registry,
      stopAgent
    );
  });

  test("scan terminates agents idle longer than timeout", async () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "Needs Feedback" } as any,
    ]);

    // Backdate idle start time to 20 minutes ago
    const info = registry.getAgentIdleInfo("Frank", "agent-1");
    if (info) {
      info.idleStartTime = new Date(Date.now() - 20 * 60 * 1000);
    }

    await scanner.scan();

    expect(stopAgent).toHaveBeenCalledTimes(1);
    expect(stopAgent).toHaveBeenCalledWith("http://frank.local:5678", "agent-1");
  });

  test("scan does not terminate agents below timeout", async () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "Needs Feedback" } as any,
    ]);

    // Idle for only 5 minutes (below 15 min threshold)
    const info = registry.getAgentIdleInfo("Frank", "agent-1");
    if (info) {
      info.idleStartTime = new Date(Date.now() - 5 * 60 * 1000);
    }

    await scanner.scan();

    expect(stopAgent).not.toHaveBeenCalled();
  });

  test("scan ignores agents not in idle states", async () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "In Progress" } as any,
    ]);

    await scanner.scan();

    expect(stopAgent).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/hub/idle-scanner.test.ts`
Expected: FAIL - module not found

**Step 3: Implement IdleScanner**

Create `src/hub/idle-scanner.ts`:

```typescript
// ABOUTME: Scans for idle agents and terminates them to save costs.
// ABOUTME: Runs on hub, checks heartbeat data for agents stuck in idle states.

import type { MachineRegistry } from "./registry";

export interface IdleScannerConfig {
  enabled: boolean;
  timeoutMinutes: number;
  idleStates: string[];
  scanIntervalSeconds: number;
}

export class IdleScanner {
  private config: IdleScannerConfig;
  private registry: MachineRegistry;
  private stopAgent: (machineUrl: string, agentKey: string) => Promise<void>;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: IdleScannerConfig,
    registry: MachineRegistry,
    stopAgent: (machineUrl: string, agentKey: string) => Promise<void>
  ) {
    this.config = config;
    this.registry = registry;
    this.stopAgent = stopAgent;
  }

  /**
   * Scan for idle agents and terminate them.
   */
  async scan(): Promise<void> {
    if (!this.config.enabled) return;

    const thresholdMs = this.config.timeoutMinutes * 60 * 1000;
    const idleAgents = this.registry.getIdleAgents(this.config.idleStates, thresholdMs);

    for (const agent of idleAgents) {
      const idleMinutes = Math.round(agent.idleDurationMs / 60_000);
      console.log(
        `[IdleScanner] Agent ${agent.agentKey} idle for ${idleMinutes}m in "${agent.linearState}" - terminating`
      );

      try {
        await this.stopAgent(agent.machineUrl, agent.agentKey);
        this.registry.clearAgentIdleTracking(agent.machineName, agent.agentKey);
        console.log(
          `[IdleScanner] Sent stop command to ${agent.machineName} for ${agent.agentKey}`
        );
      } catch (err) {
        console.warn(
          `[IdleScanner] Failed to stop ${agent.agentKey}: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }
  }

  /**
   * Start the periodic scanner.
   */
  start(): void {
    if (!this.config.enabled) {
      console.log("[IdleScanner] Disabled, not starting");
      return;
    }

    if (this.intervalId) return;

    this.intervalId = setInterval(
      () => this.scan(),
      this.config.scanIntervalSeconds * 1000
    );

    console.log(
      `[IdleScanner] Started, checking every ${this.config.scanIntervalSeconds}s for agents idle >${this.config.timeoutMinutes}m in: ${this.config.idleStates.join(", ")}`
    );
  }

  /**
   * Stop the periodic scanner.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[IdleScanner] Stopped");
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/hub/idle-scanner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hub/idle-scanner.ts src/hub/idle-scanner.test.ts
git commit -m "feat: add IdleScanner class"
```

---

### Task 4: Integrate IdleScanner into Server

**Files:**
- Modify: `src/server.ts`

**Step 1: Add imports and initialization**

Add import at top of file:

```typescript
import { IdleScanner } from "./hub/idle-scanner";
```

**Step 2: Create stop agent helper function**

Add after the hub heartbeat initialization (around line 210):

```typescript
// Initialize idle scanner for hub/standalone mode
let idleScanner: IdleScanner | null = null;

if ((isHubMode() || isStandaloneMode()) && machineRegistry) {
  const idleConfig = resolvedConfig.global.idleTermination ?? {
    enabled: true,
    timeoutMinutes: 15,
    idleStates: ["Needs Feedback"],
    scanIntervalSeconds: 60,
  };

  const stopRemoteAgent = async (machineUrl: string, agentKey: string) => {
    // For local machine (empty URL), stop directly
    if (!machineUrl && orchestrator) {
      await orchestrator.stopAgent(agentKey, "idle");
      return;
    }

    // For remote machines, use proxy
    const machine = machineRegistry!.getAll().find(m => m.url === machineUrl);
    if (!machine) {
      throw new Error(`Machine not found for URL: ${machineUrl}`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (machine.apiKey) {
      headers["Authorization"] = `Bearer ${machine.apiKey}`;
    }

    const res = await fetch(`${machineUrl}/agents/${encodeURIComponent(agentKey)}/stop`, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  };

  idleScanner = new IdleScanner(idleConfig, machineRegistry, stopRemoteAgent);
  idleScanner.start();
}
```

**Step 3: Add cleanup on shutdown**

Find the shutdown handler and add:

```typescript
if (idleScanner) {
  idleScanner.stop();
}
```

**Step 4: Run type check**

Run: `bun run tsc --noEmit`
Expected: No errors

**Step 5: Test manually**

Run: `bun run src/server.ts`
Expected: See "[IdleScanner] Started..." in logs

**Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: integrate IdleScanner into hub server"
```

---

### Task 5: End-to-End Test

**Step 1: Start local server**

```bash
bun run src/server.ts
```

**Step 2: Verify scanner is running**

Check logs for: `[IdleScanner] Started, checking every 60s...`

**Step 3: Run all tests**

```bash
bun test
```

Expected: All tests pass

**Step 4: Final commit and push**

```bash
git push origin monitor
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add config schema for idle termination |
| 2 | Add idle tracking to registry |
| 3 | Create IdleScanner class |
| 4 | Integrate into server |
| 5 | End-to-end test |

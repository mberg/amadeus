# Hub Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Amadeus to cleanly separate routing (hub) from agent execution (machine), while preserving standalone mode for solo users.

**Architecture:** Single binary with three modes: `standalone` (default, current behavior), `hub` (routing + aggregate dashboard), `machine` (agent execution + local dashboard). Code restructured into `hub/`, `machine/`, `shared/` directories.

**Tech Stack:** Bun, React, Zod, SQLite

---

## Task 1: Update Config Schema for New Modes

**Files:**
- Modify: `src/config-schema.ts`

**Step 1: Write test for new RuntimeMode values**

Create test file:
```typescript
// src/config-schema.test.ts
import { describe, test, expect } from "bun:test";
import { RuntimeModeSchema, MachineConfigSchema, AmadeusConfigSchema } from "./config-schema";

describe("RuntimeModeSchema", () => {
  test("accepts 'standalone' mode", () => {
    expect(RuntimeModeSchema.parse("standalone")).toBe("standalone");
  });

  test("accepts 'hub' mode", () => {
    expect(RuntimeModeSchema.parse("hub")).toBe("hub");
  });

  test("accepts 'machine' mode", () => {
    expect(RuntimeModeSchema.parse("machine")).toBe("machine");
  });

  test("defaults to 'standalone'", () => {
    expect(RuntimeModeSchema.parse(undefined)).toBe("standalone");
  });

  test("rejects invalid modes", () => {
    expect(() => RuntimeModeSchema.parse("invalid")).toThrow();
  });
});

describe("MachineConfigSchema", () => {
  test("validates machine config with name", () => {
    const result = MachineConfigSchema.parse({
      name: "Frank",
      heartbeat: true,
    });
    expect(result.name).toBe("Frank");
    expect(result.heartbeat).toBe(true);
  });

  test("heartbeat defaults to false", () => {
    const result = MachineConfigSchema.parse({ name: "Bob" });
    expect(result.heartbeat).toBe(false);
  });

  test("hub URL is optional", () => {
    const result = MachineConfigSchema.parse({ name: "Local" });
    expect(result.hubUrl).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/config-schema.test.ts`
Expected: FAIL - MachineConfigSchema not exported

**Step 3: Update RuntimeModeSchema and add MachineConfigSchema**

In `src/config-schema.ts`, update RuntimeModeSchema:
```typescript
/**
 * Runtime mode for the Amadeus server.
 * - 'standalone': Hub + Machine combined (default, for solo users)
 * - 'hub': Routing + aggregate dashboard only (no agent execution)
 * - 'machine': Agent execution + local dashboard only
 */
export const RuntimeModeSchema = z.enum(["standalone", "hub", "machine"]).default("standalone");
```

Add MachineConfigSchema:
```typescript
/**
 * Schema for machine identity and settings.
 */
export const MachineConfigSchema = z.object({
  name: z.string().min(1, "Machine name cannot be empty"),
  hubUrl: z.string().url().optional(), // URL of hub to register with
  heartbeat: z.boolean().default(false), // Whether to send heartbeats
});

export type MachineConfig = z.infer<typeof MachineConfigSchema>;
```

Update GlobalConfigSchema to include machine config:
```typescript
export const GlobalConfigSchema = z.object({
  // ... existing fields ...
  runtimeMode: RuntimeModeSchema,
  machine: MachineConfigSchema.optional(),
});
```

**Step 4: Run test to verify it passes**

Run: `bun test src/config-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config-schema.ts src/config-schema.test.ts
git commit -m "feat: add standalone/hub/machine modes and machine config schema"
```

---

## Task 2: Update Config Loader for New Modes

**Files:**
- Modify: `src/config-loader.ts`
- Modify: `src/config.ts`

**Step 1: Write test for config mode detection**

Add to test file:
```typescript
// src/config.test.ts
import { describe, test, expect } from "bun:test";
import { getRuntimeMode, getMachineConfig, isHubMode, isMachineMode, isStandaloneMode } from "./config";

describe("Runtime mode helpers", () => {
  test("getRuntimeMode returns configured mode", () => {
    // This will use the actual config, so test the helper functions work
    const mode = getRuntimeMode();
    expect(["standalone", "hub", "machine"]).toContain(mode);
  });

  test("mode helpers are mutually exclusive", () => {
    const isHub = isHubMode();
    const isMachine = isMachineMode();
    const isStandalone = isStandaloneMode();

    // Exactly one should be true
    const trueCount = [isHub, isMachine, isStandalone].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });
});

describe("Machine config", () => {
  test("getMachineConfig returns config or default", () => {
    const config = getMachineConfig();
    expect(config).toHaveProperty("name");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/config.test.ts`
Expected: FAIL - isHubMode, isMachineMode, isStandaloneMode not exported

**Step 3: Add mode helpers to config.ts**

```typescript
/**
 * Check if running in hub mode (routing + aggregate dashboard only).
 */
export function isHubMode(): boolean {
  return getRuntimeMode() === "hub";
}

/**
 * Check if running in machine mode (agent execution + local dashboard only).
 */
export function isMachineMode(): boolean {
  return getRuntimeMode() === "machine";
}

/**
 * Check if running in standalone mode (hub + machine combined).
 */
export function isStandaloneMode(): boolean {
  return getRuntimeMode() === "standalone";
}

/**
 * Get machine configuration with defaults.
 */
export function getMachineConfig(): { name: string; hubUrl?: string; heartbeat: boolean } {
  if (REALM_CONFIG?.global.machine) {
    return REALM_CONFIG.global.machine;
  }
  // Default machine config for standalone/legacy mode
  return {
    name: process.env.HOSTNAME ?? "Local",
    heartbeat: false,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add runtime mode helpers and machine config accessor"
```

---

## Task 3: Create Shared Directory Structure

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/linear.ts`
- Create: `src/shared/config.ts`

**Step 1: Create shared directory and move types**

```bash
mkdir -p src/shared
```

**Step 2: Create src/shared/types.ts with core types**

Move and export from `src/types.ts`:
```typescript
// src/shared/types.ts
// ABOUTME: Core TypeScript interfaces shared across hub and machine.
// ABOUTME: Defines webhook payloads, agent status, and configuration types.

// Re-export all types from the main types file for now
// This will be the canonical location going forward
export * from "../types";
```

**Step 3: Create src/shared/linear.ts**

```typescript
// src/shared/linear.ts
// ABOUTME: Linear API client functions shared across hub and machine.
// ABOUTME: Re-exports from main linear module.

export * from "../linear";
```

**Step 4: Create src/shared/config.ts**

```typescript
// src/shared/config.ts
// ABOUTME: Configuration utilities shared across hub and machine.
// ABOUTME: Re-exports from main config module.

export {
  CONFIG,
  REALM_CONFIG,
  getRuntimeMode,
  isHubMode,
  isMachineMode,
  isStandaloneMode,
  getMachineConfig,
  getRealmByTeamKey,
  getAllWebhookSecrets,
  getSecurityConfig,
  getRouterConfig,
  getServerPort,
  getSpriteUrlForProject,
} from "../config";
```

**Step 5: Commit**

```bash
git add src/shared/
git commit -m "refactor: create shared directory with re-exports"
```

---

## Task 4: Create Machine Module Structure

**Files:**
- Create: `src/machine/index.ts`
- Create: `src/machine/orchestrator.ts`

**Step 1: Create machine directory**

```bash
mkdir -p src/machine
```

**Step 2: Create src/machine/orchestrator.ts**

```typescript
// src/machine/orchestrator.ts
// ABOUTME: Agent orchestration for machine mode.
// ABOUTME: Re-exports ClaudeOrchestrator from main module.

export { ClaudeOrchestrator } from "../orchestrator";
export type { AgentDeathInfo, AgentCompletionInfo, OrchestratorConfig } from "../orchestrator";
```

**Step 3: Create src/machine/index.ts**

```typescript
// src/machine/index.ts
// ABOUTME: Machine mode entry point.
// ABOUTME: Exports orchestration and persistence for agent execution.

export * from "./orchestrator";
export { AgentPersistence } from "../persistence";
export { HealthMonitor } from "../health-monitor";
```

**Step 4: Commit**

```bash
git add src/machine/
git commit -m "refactor: create machine module structure"
```

---

## Task 5: Create Hub Module Structure

**Files:**
- Create: `src/hub/index.ts`
- Create: `src/hub/router.ts`
- Create: `src/hub/registry.ts`

**Step 1: Create hub directory**

```bash
mkdir -p src/hub
```

**Step 2: Create src/hub/router.ts with webhook routing logic**

```typescript
// src/hub/router.ts
// ABOUTME: Webhook routing logic for hub mode.
// ABOUTME: Determines which machine should handle an incoming webhook.

import type { LinearWebhookPayload, LinearIssue, LinearComment } from "../shared/types";
import { REALM_CONFIG } from "../shared/config";

export interface RouteResult {
  machineUrl: string | null; // null means process locally
  machineName: string | null;
  reason: string;
}

function isComment(data: LinearIssue | LinearComment): data is LinearComment {
  return "body" in data && "issueId" in data;
}

/**
 * Get team key from webhook payload.
 */
export function getTeamKeyFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.identifier?.split("-")[0] ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.identifier?.split("-")[0] ?? null;
  }

  return null;
}

/**
 * Get project name from webhook payload.
 */
export function getProjectNameFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.project?.name ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.project?.name ?? null;
  }

  return null;
}

/**
 * Determine which machine should handle a webhook.
 */
export function routeWebhook(payload: LinearWebhookPayload): RouteResult {
  const teamKey = getTeamKeyFromPayload(payload);
  const projectName = getProjectNameFromPayload(payload);

  if (!REALM_CONFIG) {
    return { machineUrl: null, machineName: null, reason: "No realm config" };
  }

  // Search for matching project with machine assignment
  for (const realm of REALM_CONFIG.realms) {
    for (const project of realm.projects) {
      // Match by Linear project name (case-insensitive)
      if (projectName && project.linearProject?.toLowerCase() === projectName.toLowerCase()) {
        if (project.spriteUrl) {
          return {
            machineUrl: project.spriteUrl,
            machineName: project.linearProject ?? teamKey ?? "unknown",
            reason: `Matched project "${projectName}"`,
          };
        }
      }
    }
  }

  // Fall back to team key lookup
  if (teamKey) {
    const entry = REALM_CONFIG.projectByTeamKey.get(teamKey);
    if (entry?.project.spriteUrl) {
      return {
        machineUrl: entry.project.spriteUrl,
        machineName: teamKey,
        reason: `Matched team "${teamKey}"`,
      };
    }
  }

  return { machineUrl: null, machineName: null, reason: "No machine routing configured" };
}
```

**Step 3: Create src/hub/registry.ts for machine registry**

```typescript
// src/hub/registry.ts
// ABOUTME: Machine registry for hub mode.
// ABOUTME: Tracks known machines and their status.

export interface MachineInfo {
  name: string;
  url: string;
  lastSeen?: Date;
  agentCount?: number;
  status: "unknown" | "healthy" | "unhealthy";
}

export class MachineRegistry {
  private machines = new Map<string, MachineInfo>();

  /**
   * Register or update a machine.
   */
  register(name: string, url: string): void {
    this.machines.set(name, {
      name,
      url,
      lastSeen: new Date(),
      status: "unknown",
    });
  }

  /**
   * Get all registered machines.
   */
  getAll(): MachineInfo[] {
    return Array.from(this.machines.values());
  }

  /**
   * Get a machine by name.
   */
  get(name: string): MachineInfo | undefined {
    return this.machines.get(name);
  }

  /**
   * Update machine status from health check.
   */
  updateStatus(name: string, status: MachineInfo["status"], agentCount?: number): void {
    const machine = this.machines.get(name);
    if (machine) {
      machine.status = status;
      machine.agentCount = agentCount;
      machine.lastSeen = new Date();
    }
  }

  /**
   * Load machines from static config.
   */
  loadFromConfig(machines: Array<{ name: string; url: string }>): void {
    for (const m of machines) {
      this.register(m.name, m.url);
    }
  }
}
```

**Step 4: Create src/hub/index.ts**

```typescript
// src/hub/index.ts
// ABOUTME: Hub mode entry point.
// ABOUTME: Exports routing and registry for webhook orchestration.

export * from "./router";
export * from "./registry";
```

**Step 5: Commit**

```bash
git add src/hub/
git commit -m "refactor: create hub module with router and registry"
```

---

## Task 6: Write Tests for Hub Router

**Files:**
- Create: `src/hub/router.test.ts`

**Step 1: Write router tests**

```typescript
// src/hub/router.test.ts
import { describe, test, expect } from "bun:test";
import { getTeamKeyFromPayload, getProjectNameFromPayload } from "./router";
import type { LinearWebhookPayload } from "../shared/types";

describe("getTeamKeyFromPayload", () => {
  test("extracts team key from issue identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "ENG-456",
        title: "Test issue",
      },
    };
    expect(getTeamKeyFromPayload(payload)).toBe("ENG");
  });

  test("extracts team key from comment issue", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      data: {
        id: "c1",
        body: "Test comment",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "DATA-789",
          title: "Test issue",
        },
        createdAt: new Date().toISOString(),
      },
    };
    expect(getTeamKeyFromPayload(payload)).toBe("DATA");
  });

  test("returns null for missing identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "",
        title: "Test issue",
      },
    };
    expect(getTeamKeyFromPayload(payload)).toBe("");
  });
});

describe("getProjectNameFromPayload", () => {
  test("extracts project name from issue", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "ENG-456",
        title: "Test issue",
        project: { id: "p1", name: "MyProject" },
      },
    };
    expect(getProjectNameFromPayload(payload)).toBe("MyProject");
  });

  test("returns null when no project", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "ENG-456",
        title: "Test issue",
      },
    };
    expect(getProjectNameFromPayload(payload)).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `bun test src/hub/router.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/hub/router.test.ts
git commit -m "test: add hub router unit tests"
```

---

## Task 7: Write Tests for Machine Registry

**Files:**
- Create: `src/hub/registry.test.ts`

**Step 1: Write registry tests**

```typescript
// src/hub/registry.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { MachineRegistry } from "./registry";

describe("MachineRegistry", () => {
  let registry: MachineRegistry;

  beforeEach(() => {
    registry = new MachineRegistry();
  });

  test("registers a new machine", () => {
    registry.register("Frank", "http://frank.local:5678");
    const machine = registry.get("Frank");
    expect(machine).toBeDefined();
    expect(machine?.name).toBe("Frank");
    expect(machine?.url).toBe("http://frank.local:5678");
    expect(machine?.status).toBe("unknown");
  });

  test("updates existing machine on re-register", () => {
    registry.register("Frank", "http://old.url");
    registry.register("Frank", "http://new.url");
    const machine = registry.get("Frank");
    expect(machine?.url).toBe("http://new.url");
  });

  test("getAll returns all machines", () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.register("Bob", "http://bob.local:5678");
    const all = registry.getAll();
    expect(all.length).toBe(2);
    expect(all.map(m => m.name).sort()).toEqual(["Bob", "Frank"]);
  });

  test("updateStatus updates machine health", () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", 3);
    const machine = registry.get("Frank");
    expect(machine?.status).toBe("healthy");
    expect(machine?.agentCount).toBe(3);
  });

  test("loadFromConfig registers multiple machines", () => {
    registry.loadFromConfig([
      { name: "Frank", url: "http://frank.local:5678" },
      { name: "Bob", url: "http://bob.local:5678" },
    ]);
    expect(registry.getAll().length).toBe(2);
  });
});
```

**Step 2: Run tests**

Run: `bun test src/hub/registry.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/hub/registry.test.ts
git commit -m "test: add machine registry unit tests"
```

---

## Task 8: Refactor Server to Use Mode-Based Initialization

**Files:**
- Modify: `src/server.ts`

**Step 1: Write test for mode-based behavior**

```typescript
// src/server.test.ts
import { describe, test, expect } from "bun:test";
import { isHubMode, isMachineMode, isStandaloneMode } from "./config";

describe("Server mode initialization", () => {
  test("mode helpers work correctly", () => {
    // At least one mode should be active
    const hasActiveMode = isHubMode() || isMachineMode() || isStandaloneMode();
    expect(hasActiveMode).toBe(true);
  });
});
```

**Step 2: Refactor server.ts to conditionally initialize components**

At the top of server.ts, after imports, add mode checks:

```typescript
import { isHubMode, isMachineMode, isStandaloneMode, getMachineConfig } from "./config";
import { MachineRegistry } from "./hub/registry";
import { routeWebhook } from "./hub/router";

// Mode-based initialization
const machineConfig = getMachineConfig();
console.log(`[Server] Starting in ${getRuntimeMode()} mode as "${machineConfig.name}"`);

// Hub components (hub or standalone mode)
let machineRegistry: MachineRegistry | null = null;
if (isHubMode() || isStandaloneMode()) {
  machineRegistry = new MachineRegistry();
  // Load static machine config if present
  if (REALM_CONFIG?.global.machines) {
    machineRegistry.loadFromConfig(REALM_CONFIG.global.machines);
  }
}

// Machine components (machine or standalone mode)
let orchestrator: ClaudeOrchestrator | null = null;
let persistence: AgentPersistence | null = null;
let healthMonitor: HealthMonitor | null = null;

if (isMachineMode() || isStandaloneMode()) {
  persistence = new AgentPersistence(CONFIG.dbPath);

  orchestrator = new ClaudeOrchestrator({
    // ... existing config ...
  });

  healthMonitor = new HealthMonitor({
    // ... existing config ...
  });

  healthMonitor.start();
}
```

**Step 3: Update webhook handler for hub mode**

In the webhook handler, add hub-mode routing:

```typescript
if (req.method === "POST" && url.pathname === "/webhook") {
  // ... signature verification ...

  // In hub mode, route to machines
  if (isHubMode()) {
    const route = routeWebhook(data);
    if (route.machineUrl) {
      forwardWebhookToSprite(route.machineUrl, payload, signature, route.machineName ?? "unknown");
      return new Response("OK", { status: 200 });
    }
    // No routing configured - return error in hub mode
    console.warn("[Webhook] Hub mode but no machine routing configured");
    return new Response("No machine configured for this webhook", { status: 422 });
  }

  // Machine or standalone mode - process locally
  if (!orchestrator) {
    return new Response("Machine components not initialized", { status: 500 });
  }

  // ... existing local handling ...
}
```

**Step 4: Run server tests**

Run: `bun test src/server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "refactor: add mode-based initialization to server"
```

---

## Task 9: Add Hub Status Endpoint

**Files:**
- Modify: `src/server.ts`

**Step 1: Add /hub/status endpoint for aggregate view**

```typescript
// Hub status endpoint (returns all machines and their agents)
if (req.method === "GET" && url.pathname === "/hub/status") {
  if (!isHubMode() && !isStandaloneMode()) {
    return new Response("Not available in machine mode", { status: 404 });
  }

  const authError = await requireViewer(req);
  if (authError) return authError;

  const machines = machineRegistry?.getAll() ?? [];

  // Fetch status from each machine (with timeout)
  const machineStatuses = await Promise.all(
    machines.map(async (machine) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${machine.url}/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          return {
            ...machine,
            status: "healthy" as const,
            agents: data.agents,
            agentCount: data.agents?.length ?? 0,
          };
        }
        return { ...machine, status: "unhealthy" as const, agents: [], agentCount: 0 };
      } catch {
        return { ...machine, status: "unhealthy" as const, agents: [], agentCount: 0 };
      }
    })
  );

  // Include local machine if in standalone mode
  let localStatus = null;
  if (isStandaloneMode() && orchestrator) {
    const agents = await orchestrator.getStatusWithMemory();
    localStatus = {
      name: machineConfig.name,
      url: `http://localhost:${serverPort}`,
      status: "healthy" as const,
      agents,
      agentCount: agents.length,
    };
  }

  return Response.json({
    machines: localStatus ? [localStatus, ...machineStatuses] : machineStatuses,
    timestamp: new Date().toISOString(),
  });
}
```

**Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: add /hub/status endpoint for aggregate machine view"
```

---

## Task 10: Add Machines Config to Schema

**Files:**
- Modify: `src/config-schema.ts`

**Step 1: Add machines array to GlobalConfigSchema**

```typescript
/**
 * Schema for a static machine entry (for hub config).
 */
export const StaticMachineSchema = z.object({
  name: z.string().min(1, "Machine name cannot be empty"),
  url: z.string().url("Machine URL must be valid"),
});

export type StaticMachine = z.infer<typeof StaticMachineSchema>;

// Update GlobalConfigSchema:
export const GlobalConfigSchema = z.object({
  // ... existing fields ...
  machine: MachineConfigSchema.optional(),
  machines: z.array(StaticMachineSchema).optional(), // Static machine list for hub mode
});
```

**Step 2: Commit**

```bash
git add src/config-schema.ts
git commit -m "feat: add static machines config for hub mode"
```

---

## Task 11: Update Config Loader to Resolve Machines

**Files:**
- Modify: `src/config-loader.ts`
- Modify: `src/config-schema.ts`

**Step 1: Add machines to ResolvedConfig**

In `src/config-schema.ts`:
```typescript
export interface ResolvedConfig {
  // ... existing fields ...
  machines?: Array<{ name: string; url: string }>;
}
```

**Step 2: Update config-loader.ts to resolve machines**

```typescript
// In loadConfig function, after resolving realms:
const machines = config.global.machines?.map(m => ({
  name: m.name,
  url: m.url,
}));

return {
  realms: resolvedRealms,
  global: config.global,
  router: resolvedRouter,
  machines,
  // ... convenience lookups ...
};
```

**Step 3: Commit**

```bash
git add src/config-loader.ts src/config-schema.ts
git commit -m "feat: resolve static machines config in loader"
```

---

## Task 12: Update Dashboard for Hub View

**Files:**
- Create: `src/dashboard/components/MachinesView.tsx`
- Modify: `src/dashboard/App.tsx`

**Step 1: Create MachinesView component**

```typescript
// src/dashboard/components/MachinesView.tsx
// ABOUTME: Displays all registered machines and their agent counts.
// ABOUTME: Used in hub mode for aggregate visibility.

import { useState, useEffect } from "react";

interface MachineStatus {
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  agentCount: number;
  agents: Array<{
    key: string;
    issueIdentifier: string;
    issueTitle: string;
    linearState?: string;
  }>;
}

interface HubStatus {
  machines: MachineStatus[];
  timestamp: string;
}

export function MachinesView() {
  const [hubStatus, setHubStatus] = useState<HubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/hub/status");
        if (res.ok) {
          const data = await res.json();
          setHubStatus(data);
          setError(null);
        } else if (res.status === 404) {
          setError("Hub view not available in this mode");
        } else {
          setError(`Failed to fetch status: ${res.status}`);
        }
      } catch (err) {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="p-8">Loading machines...</div>;
  }

  if (error) {
    return <div className="p-8 text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Machines</h1>
        <p className="text-muted-foreground">
          Overview of all registered machines
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hubStatus?.machines.map((machine) => (
          <div
            key={machine.name}
            className="rounded-lg border bg-card p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{machine.name}</h3>
              <span
                className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                  machine.status === "healthy"
                    ? "bg-green-100 text-green-800"
                    : machine.status === "unhealthy"
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {machine.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {machine.agentCount} agent{machine.agentCount !== 1 ? "s" : ""} running
            </p>
            <a
              href={`${machine.url}/dashboard`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm text-blue-600 hover:underline"
            >
              Open Dashboard →
            </a>
          </div>
        ))}
      </div>

      {hubStatus && (
        <div className="text-xs text-muted-foreground">
          Last updated {new Date(hubStatus.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add Machines nav item to Sidebar**

In `src/dashboard/components/Sidebar.tsx`, add "machines" to NavItem type and render it.

**Step 3: Update App.tsx to show MachinesView**

```typescript
import { MachinesView } from "./components/MachinesView";

// In the render, add:
{activeNav === "machines" && <MachinesView />}
```

**Step 4: Commit**

```bash
git add src/dashboard/components/MachinesView.tsx src/dashboard/components/Sidebar.tsx src/dashboard/App.tsx
git commit -m "feat: add MachinesView for hub mode aggregate dashboard"
```

---

## Task 13: Add Machine Name to Local Dashboard Header

**Files:**
- Modify: `src/dashboard/components/Header.tsx` (or create if not exists)
- Modify: `src/dashboard/hooks/useStatus.ts`

**Step 1: Add machine name to /config endpoint response**

In `src/server.ts`, update the `/config` endpoint:
```typescript
return Response.json({
  linearWorkspace: CONFIG.linearWorkspace,
  machineName: machineConfig.name,
  runtimeMode: getRuntimeMode(),
  setup,
});
```

**Step 2: Update useStatus hook to include machine info**

**Step 3: Display machine name in dashboard header**

**Step 4: Commit**

```bash
git add src/server.ts src/dashboard/
git commit -m "feat: display machine name in dashboard header"
```

---

## Task 14: Add Machine Resource Monitoring

**Files:**
- Create: `src/machine/resources.ts`
- Modify: `src/server.ts`

**Step 1: Create resource monitoring module**

```typescript
// src/machine/resources.ts
// ABOUTME: System resource monitoring for machine mode.
// ABOUTME: Reports CPU, memory, and disk usage.

import { $ } from "bun";

export interface SystemResources {
  cpuPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  memoryPercent: number;
  diskUsedGB?: number;
  diskTotalGB?: number;
  diskPercent?: number;
}

export async function getSystemResources(): Promise<SystemResources> {
  // Get memory info
  const memInfo = process.memoryUsage();
  const totalMem = require("os").totalmem();
  const freeMem = require("os").freemem();
  const usedMem = totalMem - freeMem;

  // Get CPU load average (1 minute)
  const loadAvg = require("os").loadavg()[0];
  const cpuCount = require("os").cpus().length;
  const cpuPercent = Math.min(100, (loadAvg / cpuCount) * 100);

  return {
    cpuPercent: Math.round(cpuPercent),
    memoryUsedMB: Math.round(usedMem / 1024 / 1024),
    memoryTotalMB: Math.round(totalMem / 1024 / 1024),
    memoryPercent: Math.round((usedMem / totalMem) * 100),
  };
}
```

**Step 2: Add /machine/resources endpoint**

```typescript
if (req.method === "GET" && url.pathname === "/machine/resources") {
  if (isHubMode()) {
    return new Response("Not available in hub mode", { status: 404 });
  }

  const authError = await requireViewer(req);
  if (authError) return authError;

  const resources = await getSystemResources();
  return Response.json(resources);
}
```

**Step 3: Commit**

```bash
git add src/machine/resources.ts src/server.ts
git commit -m "feat: add system resource monitoring endpoint"
```

---

## Task 15: Update Example Config File

**Files:**
- Modify: `amadeus.config.example.yaml`

**Step 1: Update example config with new mode options**

```yaml
# Amadeus Configuration
#
# Runtime modes:
# - standalone: Hub + Machine combined (default, for solo users)
# - hub: Routing + aggregate dashboard only
# - machine: Agent execution + local dashboard only

global:
  # mode: standalone  # Default - uncomment to change
  port: 5678
  agentName: Amadeus

  # Machine identity (for dashboard display)
  machine:
    name: "MyMachine"  # Friendly name shown in hub
    # hubUrl: "https://hub.example.com"  # URL to register with (if using hub)
    # heartbeat: false  # Whether to send heartbeats to hub

  # Static machines list (for hub mode)
  # machines:
  #   - name: "Frank"
  #     url: "http://frank.local:5678"
  #   - name: "Bob"
  #     url: "https://bob-sprite.sprites.dev"

  triggerStates:
    - Planning
  useWorktrees: true
  defaultProfile: base

realms:
  main:
    linearWorkspace: my-workspace
    apiKeyEnvVar: LINEAR_API_KEY
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET
    projects:
      - teamKey: ENG
        path: /path/to/project
        # spriteUrl: https://my-sprite.sprites.dev  # Forward to sprite instead of local
```

**Step 2: Commit**

```bash
git add amadeus.config.example.yaml
git commit -m "docs: update example config with mode options"
```

---

## Task 16: Final Integration Test

**Files:**
- Create: `src/integration.test.ts`

**Step 1: Write integration test for mode switching**

```typescript
// src/integration.test.ts
import { describe, test, expect } from "bun:test";
import { getRuntimeMode, isHubMode, isMachineMode, isStandaloneMode } from "./config";

describe("Mode integration", () => {
  test("default mode is standalone", () => {
    // Without explicit config, should default to standalone
    const mode = getRuntimeMode();
    // Note: actual mode depends on config file, but helpers should be consistent
    expect(["standalone", "hub", "machine"]).toContain(mode);
  });

  test("all mode helpers are available", () => {
    expect(typeof isHubMode).toBe("function");
    expect(typeof isMachineMode).toBe("function");
    expect(typeof isStandaloneMode).toBe("function");
  });
});

describe("Module imports", () => {
  test("hub module exports work", async () => {
    const hub = await import("./hub");
    expect(hub.MachineRegistry).toBeDefined();
    expect(hub.routeWebhook).toBeDefined();
  });

  test("machine module exports work", async () => {
    const machine = await import("./machine");
    expect(machine.ClaudeOrchestrator).toBeDefined();
  });

  test("shared module exports work", async () => {
    const shared = await import("./shared/types");
    // Types are compile-time, but the module should load
    expect(shared).toBeDefined();
  });
});
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/integration.test.ts
git commit -m "test: add integration tests for module structure"
```

---

## Summary

This plan restructures Amadeus into:

1. **Config changes**: New `standalone`/`hub`/`machine` modes, machine identity config
2. **Code structure**: `shared/`, `hub/`, `machine/` directories with clear separation
3. **Hub mode**: Webhook routing, machine registry, aggregate dashboard
4. **Machine mode**: Agent orchestration, local dashboard, resource monitoring
5. **Standalone mode**: Both combined (current behavior, default)

The refactor is incremental - each task builds on the previous, with tests at each step.

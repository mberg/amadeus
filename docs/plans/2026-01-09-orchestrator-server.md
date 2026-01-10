# Amadeus Orchestrator Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Bun server that receives Linear webhooks and manages Claude Code agent instances via AgentAPI.

**Architecture:** Single-file Bun server with webhook receiver, HMAC signature verification, and process manager. Linear webhooks trigger Claude Code agent spawning, with bidirectional communication via Linear MCP.

**Tech Stack:** Bun, TypeScript, AgentAPI CLI

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/server.ts` (stub)

**Step 1: Initialize Bun project**

Run:
```bash
cd /Users/mberg/github/amadeus && bun init -y
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Step 3: Install dev dependencies**

Run:
```bash
bun add -d bun-types @types/node
```

**Step 4: Create .env.example**

```bash
LINEAR_WEBHOOK_SECRET=your_linear_signing_secret
LINEAR_API_KEY=your_api_key
CLAUDE_BOT_USER_ID=optional_user_id_for_assignment_trigger
```

**Step 5: Create stub server file**

Create `src/server.ts`:
```typescript
// ABOUTME: Amadeus orchestrator server - receives Linear webhooks and manages Claude Code agents.
// ABOUTME: Entry point for the Bun server.

console.log("Amadeus starting...");
```

**Step 6: Verify it runs**

Run:
```bash
bun run src/server.ts
```
Expected: "Amadeus starting..."

**Step 7: Commit**

```bash
git add -A && git commit -m "chore: initialize bun project with typescript config"
```

---

## Task 2: Types and Configuration

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`

**Step 1: Create types.ts**

```typescript
// ABOUTME: TypeScript interfaces for Linear webhook payloads and agent instances.
// ABOUTME: Defines the data structures used throughout the orchestrator.

import type { Subprocess } from "bun";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  state?: { id: string; name: string };
  assignee?: { id: string };
  labels?: { name: string }[];
  team?: { key: string };
}

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment";
  data: LinearIssue;
}

export interface AgentInstance {
  process: Subprocess;
  port: number;
  projectPath: string;
  linearIssueId: string;
  issueIdentifier: string;
  status: "starting" | "idle" | "working";
  startedAt: Date;
}

export interface AgentStatus {
  key: string;
  port: number;
  issueId: string;
  issueIdentifier: string;
  status: string;
  uptime: number;
}
```

**Step 2: Create config.ts**

```typescript
// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Loads environment variables and defines project path mappings.

export const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? "",
  claudeBotUserId: process.env.CLAUDE_BOT_USER_ID,

  // Map Linear team keys to local project paths
  projectPaths: {
    DEFAULT: process.env.DEFAULT_PROJECT_PATH ?? "/tmp/amadeus-default",
  } as Record<string, string>,

  // Workflow states that trigger agent spawn
  triggerStates: ["Scoping", "Ready to Build"],
};
```

**Step 3: Verify types compile**

Run:
```bash
bun build src/types.ts --outdir /tmp/amadeus-check
```
Expected: No errors

**Step 4: Commit**

```bash
git add src/types.ts src/config.ts && git commit -m "feat: add types and configuration"
```

---

## Task 3: Webhook Signature Verification

**Files:**
- Create: `src/signature.ts`
- Create: `tests/signature.test.ts`

**Step 1: Write the failing test**

Create `tests/signature.test.ts`:
```typescript
// ABOUTME: Tests for Linear webhook HMAC signature verification.
// ABOUTME: Ensures we correctly validate incoming webhook authenticity.

import { describe, expect, it } from "bun:test";
import { verifyLinearSignature } from "../src/signature";

describe("verifyLinearSignature", () => {
  const secret = "test-secret";
  const payload = '{"action":"update","type":"Issue"}';

  it("returns true for valid signature", async () => {
    // Pre-computed HMAC-SHA256 of payload with secret
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const validSignature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifyLinearSignature(payload, validSignature, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const result = await verifyLinearSignature(payload, "invalid-sig", secret);
    expect(result).toBe(false);
  });

  it("returns false for null signature", async () => {
    const result = await verifyLinearSignature(payload, null, secret);
    expect(result).toBe(false);
  });

  it("returns false for empty secret", async () => {
    const result = await verifyLinearSignature(payload, "some-sig", "");
    expect(result).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test tests/signature.test.ts
```
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `src/signature.ts`:
```typescript
// ABOUTME: HMAC-SHA256 signature verification for Linear webhooks.
// ABOUTME: Validates that incoming webhooks are authentically from Linear.

export async function verifyLinearSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expectedSignature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedSignature === signature;
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
bun test tests/signature.test.ts
```
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/signature.ts tests/signature.test.ts && git commit -m "feat: add webhook signature verification with tests"
```

---

## Task 4: Prompt Builder

**Files:**
- Create: `src/prompt.ts`
- Create: `tests/prompt.test.ts`

**Step 1: Write the failing test**

Create `tests/prompt.test.ts`:
```typescript
// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt } from "../src/prompt";
import type { LinearIssue } from "../src/types";

describe("buildPrompt", () => {
  it("includes issue identifier and title", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Add user authentication",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("ENG-42");
    expect(prompt).toContain("Add user authentication");
  });

  it("includes description when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Implement OAuth2 flow",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("Implement OAuth2 flow");
  });

  it("handles missing description", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("No description provided");
  });

  it("includes labels when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      labels: [{ name: "bug" }, { name: "urgent" }],
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("bug");
    expect(prompt).toContain("urgent");
  });

  it("includes priority when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      priority: 1,
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("1");
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test tests/prompt.test.ts
```
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `src/prompt.ts`:
```typescript
// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue } from "./types";

export function buildPrompt(issue: LinearIssue): string {
  return `
## New Task from Linear

**Issue**: ${issue.identifier} - ${issue.title}
**Priority**: ${issue.priority ?? "None"}
**Labels**: ${issue.labels?.map((l) => l.name).join(", ") || "None"}

### Description
${issue.description || "No description provided."}

### Instructions
1. First, analyze the requirements and update the Linear issue status to "Scoping"
2. Create a brief implementation plan as a comment on the issue
3. When ready to code, update status to "Building"
4. Implement the feature with tests
5. When complete, update status to "Review"
6. If you need my input, set status to "Feedback Needed" and comment with your question
`.trim();
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
bun test tests/prompt.test.ts
```
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/prompt.ts tests/prompt.test.ts && git commit -m "feat: add prompt builder with tests"
```

---

## Task 5: Orchestrator Class - Agent Lifecycle

**Files:**
- Create: `src/orchestrator.ts`
- Create: `tests/orchestrator.test.ts`

**Step 1: Write the failing test**

Create `tests/orchestrator.test.ts`:
```typescript
// ABOUTME: Tests for the Claude orchestrator agent management.
// ABOUTME: Tests agent spawning, stopping, and status tracking.

import { describe, expect, it, beforeEach, mock } from "bun:test";
import { ClaudeOrchestrator } from "../src/orchestrator";
import type { LinearIssue } from "../src/types";

describe("ClaudeOrchestrator", () => {
  let orchestrator: ClaudeOrchestrator;

  beforeEach(() => {
    orchestrator = new ClaudeOrchestrator({
      projectPaths: { TEST: "/tmp/test-project" },
      triggerStates: ["Scoping", "Ready to Build"],
    });
  });

  describe("shouldStartAgent", () => {
    it("returns true when state matches trigger states", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
      };

      expect(orchestrator.shouldStartAgent(issue)).toBe(true);
    });

    it("returns false when state does not match", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Backlog" },
        team: { key: "TEST" },
      };

      expect(orchestrator.shouldStartAgent(issue)).toBe(false);
    });

    it("returns true when assignee matches bot user ID", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Scoping"],
        claudeBotUserId: "bot-123",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Backlog" },
        assignee: { id: "bot-123" },
        team: { key: "TEST" },
      };

      expect(orchestrator.shouldStartAgent(issue)).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("returns empty array when no agents running", () => {
      expect(orchestrator.getStatus()).toEqual([]);
    });
  });

  describe("getAgentKey", () => {
    it("combines team key and issue id", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        team: { key: "TEST" },
      };

      expect(orchestrator.getAgentKey(issue)).toBe("TEST-issue-123");
    });

    it("uses DEFAULT when no team", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
      };

      expect(orchestrator.getAgentKey(issue)).toBe("DEFAULT-issue-123");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test tests/orchestrator.test.ts
```
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `src/orchestrator.ts`:
```typescript
// ABOUTME: Manages Claude Code agent instances for Linear issues.
// ABOUTME: Handles spawning, messaging, and stopping agent processes.

import { spawn, type Subprocess } from "bun";
import type { LinearIssue, AgentInstance, AgentStatus } from "./types";
import { buildPrompt } from "./prompt";

export interface OrchestratorConfig {
  projectPaths: Record<string, string>;
  triggerStates: string[];
  claudeBotUserId?: string;
}

export class ClaudeOrchestrator {
  private agents = new Map<string, AgentInstance>();
  private nextPort = 8001;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  shouldStartAgent(issue: LinearIssue): boolean {
    const stateMatch = this.config.triggerStates.includes(
      issue.state?.name ?? ""
    );
    const assigneeMatch =
      this.config.claudeBotUserId !== undefined &&
      issue.assignee?.id === this.config.claudeBotUserId;
    return stateMatch || assigneeMatch;
  }

  getAgentKey(issue: LinearIssue): string {
    const projectKey = issue.team?.key ?? "DEFAULT";
    return `${projectKey}-${issue.id}`;
  }

  getStatus(): AgentStatus[] {
    return Array.from(this.agents.entries()).map(([key, agent]) => ({
      key,
      port: agent.port,
      issueId: agent.linearIssueId,
      issueIdentifier: agent.issueIdentifier,
      status: agent.status,
      uptime: Date.now() - agent.startedAt.getTime(),
    }));
  }

  hasAgent(key: string): boolean {
    return this.agents.has(key);
  }

  async startAgent(issue: LinearIssue): Promise<void> {
    const key = this.getAgentKey(issue);
    const projectKey = issue.team?.key ?? "DEFAULT";
    const projectPath = this.config.projectPaths[projectKey];

    if (!projectPath) {
      console.error(`[Agent] No project path configured for team: ${projectKey}`);
      return;
    }

    if (this.agents.has(key)) {
      console.log(`[Agent] Agent already exists: ${key}`);
      return;
    }

    const port = this.nextPort++;
    console.log(`[Agent] Starting new agent on port ${port} for ${issue.identifier}`);

    const proc = spawn({
      cmd: ["agentapi", "server", "claude", "--port", String(port)],
      cwd: projectPath,
      env: {
        ...process.env,
        LINEAR_ISSUE_ID: issue.id,
        LINEAR_ISSUE_IDENTIFIER: issue.identifier,
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    this.agents.set(key, {
      process: proc,
      port,
      projectPath,
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      status: "starting",
      startedAt: new Date(),
    });

    await this.waitForAgent(port);

    const agent = this.agents.get(key)!;
    agent.status = "idle";

    await this.sendMessage(key, buildPrompt(issue));
  }

  private async waitForAgent(port: number, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) return;
      } catch {
        // Server not ready yet
      }
      await Bun.sleep(500);
    }
    throw new Error(`Agent on port ${port} failed to start`);
  }

  async sendMessage(key: string, message: string): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    agent.status = "working";

    try {
      await fetch(`http://localhost:${agent.port}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
    } catch (err) {
      console.error(`[Agent] Failed to send message to ${key}:`, err);
      agent.status = "idle";
    }
  }

  async stopAgent(key: string): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    console.log(`[Agent] Stopping agent: ${key}`);
    agent.process.kill();
    this.agents.delete(key);
  }
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
bun test tests/orchestrator.test.ts
```
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts && git commit -m "feat: add orchestrator class with agent lifecycle management"
```

---

## Task 6: HTTP Server Routes

**Files:**
- Modify: `src/server.ts`
- Create: `tests/server.test.ts`

**Step 1: Write the failing test**

Create `tests/server.test.ts`:
```typescript
// ABOUTME: Integration tests for the HTTP server endpoints.
// ABOUTME: Tests health, webhook, and status endpoints.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void };
let baseUrl: string;

describe("HTTP Server", () => {
  beforeAll(async () => {
    // Set required env vars for test
    process.env.LINEAR_WEBHOOK_SECRET = "test-secret";

    // Import and start server
    const mod = await import("../src/server");
    server = mod.server;
    baseUrl = `http://localhost:${mod.server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  describe("GET /health", () => {
    it("returns OK", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");
    });
  });

  describe("GET /status", () => {
    it("returns agent status as JSON", async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("agents");
      expect(data).toHaveProperty("timestamp");
      expect(Array.isArray(data.agents)).toBe(true);
    });
  });

  describe("POST /webhook", () => {
    it("rejects invalid signature", async () => {
      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": "invalid",
        },
        body: JSON.stringify({ action: "update", type: "Issue", data: {} }),
      });

      expect(res.status).toBe(401);
    });

    it("accepts valid signature", async () => {
      const payload = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          id: "test-id",
          identifier: "TEST-1",
          title: "Test issue",
          state: { id: "s1", name: "Backlog" },
        },
      });

      // Compute valid signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode("test-secret"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const signature = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": signature,
        },
        body: payload,
      });

      expect(res.status).toBe(200);
    });
  });

  describe("GET /unknown", () => {
    it("returns 404", async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test tests/server.test.ts
```
Expected: FAIL - missing exports

**Step 3: Write implementation**

Replace `src/server.ts` with:
```typescript
// ABOUTME: Amadeus orchestrator server - receives Linear webhooks and manages Claude Code agents.
// ABOUTME: Entry point for the Bun server.

import { CONFIG } from "./config";
import { verifyLinearSignature } from "./signature";
import { ClaudeOrchestrator } from "./orchestrator";
import type { LinearWebhookPayload } from "./types";

const orchestrator = new ClaudeOrchestrator({
  projectPaths: CONFIG.projectPaths,
  triggerStates: CONFIG.triggerStates,
  claudeBotUserId: CONFIG.claudeBotUserId,
});

async function handleWebhook(payload: LinearWebhookPayload): Promise<void> {
  const { action, type, data } = payload;

  if (type !== "Issue") return;

  const agentKey = orchestrator.getAgentKey(data);

  console.log(
    `[${new Date().toISOString()}] ${type} ${action}: ${data.identifier} - ${data.title}`
  );

  if (action === "remove") {
    await orchestrator.stopAgent(agentKey);
    return;
  }

  if (orchestrator.shouldStartAgent(data)) {
    if (orchestrator.hasAgent(agentKey)) {
      const { buildPrompt } = await import("./prompt");
      await orchestrator.sendMessage(agentKey, buildPrompt(data));
    } else {
      await orchestrator.startAgent(data);
    }
  }
}

export const server = Bun.serve({
  port: CONFIG.port,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("OK");
    }

    // Linear webhook endpoint
    if (req.method === "POST" && url.pathname === "/webhook") {
      const payload = await req.text();
      const signature = req.headers.get("linear-signature");

      if (
        !(await verifyLinearSignature(
          payload,
          signature,
          CONFIG.linearWebhookSecret
        ))
      ) {
        console.warn("[Webhook] Invalid signature");
        return new Response("Unauthorized", { status: 401 });
      }

      const data = JSON.parse(payload) as LinearWebhookPayload;

      // Process async, respond immediately
      handleWebhook(data).catch((err) => {
        console.error("[Webhook] Error handling webhook:", err);
      });

      return new Response("OK", { status: 200 });
    }

    // Status dashboard (JSON)
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({
        agents: orchestrator.getStatus(),
        timestamp: new Date().toISOString(),
      });
    }

    // Manual trigger endpoint
    if (req.method === "POST" && url.pathname === "/trigger") {
      const { agentKey, message } = await req.json();
      await orchestrator.sendMessage(agentKey, message);
      return new Response("Sent");
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🎼 Amadeus listening on http://localhost:${server.port}`);
console.log(`   Webhook URL: https://your-machine.ts.net/webhook`);
console.log(`   Status: http://localhost:${server.port}/status`);
```

**Step 4: Run test to verify it passes**

Run:
```bash
bun test tests/server.test.ts
```
Expected: All 5 tests PASS

**Step 5: Run all tests**

Run:
```bash
bun test
```
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/server.ts tests/server.test.ts && git commit -m "feat: add HTTP server with webhook, health, and status endpoints"
```

---

## Task 7: Add Project Path Configuration

**Files:**
- Modify: `src/config.ts`
- Create: `.env.example` (update)

**Step 1: Update config to load from environment**

Modify `src/config.ts`:
```typescript
// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Loads environment variables and defines project path mappings.

function loadProjectPaths(): Record<string, string> {
  const paths: Record<string, string> = {};

  // Load from PROJECT_PATHS env var (format: "TEAM1:/path1,TEAM2:/path2")
  const pathsEnv = process.env.PROJECT_PATHS;
  if (pathsEnv) {
    for (const mapping of pathsEnv.split(",")) {
      const [key, path] = mapping.split(":");
      if (key && path) {
        paths[key.trim()] = path.trim();
      }
    }
  }

  // Fallback default
  if (Object.keys(paths).length === 0) {
    paths.DEFAULT = process.env.DEFAULT_PROJECT_PATH ?? "/tmp/amadeus-default";
  }

  return paths;
}

export const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? "",
  claudeBotUserId: process.env.CLAUDE_BOT_USER_ID,
  projectPaths: loadProjectPaths(),
  triggerStates: (process.env.TRIGGER_STATES ?? "Scoping,Ready to Build").split(","),
};
```

**Step 2: Update .env.example**

```bash
# Required
LINEAR_WEBHOOK_SECRET=your_linear_signing_secret

# Optional
LINEAR_API_KEY=your_api_key
CLAUDE_BOT_USER_ID=optional_user_id_for_assignment_trigger
PORT=3000

# Project path mappings (format: TEAM_KEY:/path/to/project)
PROJECT_PATHS=ONA:/Users/matt/code/ona,RECODE:/Users/matt/code/recode-labs

# Fallback if no PROJECT_PATHS set
DEFAULT_PROJECT_PATH=/tmp/amadeus-default

# Workflow states that trigger agent spawn (comma-separated)
TRIGGER_STATES=Scoping,Ready to Build
```

**Step 3: Verify server still runs**

Run:
```bash
LINEAR_WEBHOOK_SECRET=test bun run src/server.ts &
curl http://localhost:3000/health
```
Expected: "OK"

**Step 4: Commit**

```bash
git add src/config.ts .env.example && git commit -m "feat: add flexible project path configuration via env vars"
```

---

## Task 8: Add README Documentation

**Files:**
- Modify: `README.md`

**Step 1: Update README.md**

```markdown
# Amadeus

Amadeus uses Linear as a control plane to manage multiple Claude Code agents. Each agent runs on a dedicated port, working on different projects. Linear's Kanban board becomes the UI for orchestrating AI-powered development.

## Quick Start

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your Linear webhook secret and project paths

# Start the server
bun run src/server.ts

# Expose via Tailscale Funnel (in another terminal)
tailscale funnel --bg 3000
```

## Configuration

Set these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_WEBHOOK_SECRET` | Yes | Signing secret from Linear webhook settings |
| `PROJECT_PATHS` | No | Team-to-path mappings: `TEAM1:/path1,TEAM2:/path2` |
| `TRIGGER_STATES` | No | States that spawn agents (default: `Scoping,Ready to Build`) |
| `CLAUDE_BOT_USER_ID` | No | Linear user ID to trigger on assignment |
| `PORT` | No | Server port (default: 3000) |

## Endpoints

- `GET /health` - Health check
- `GET /status` - JSON status of all running agents
- `POST /webhook` - Linear webhook receiver
- `POST /trigger` - Manual agent message: `{"agentKey": "...", "message": "..."}`

## Linear Setup

1. Go to **Settings → API** in Linear
2. Create a new webhook pointing to `https://your-machine.ts.net/webhook`
3. Select events: Issues, Comments
4. Save the signing secret as `LINEAR_WEBHOOK_SECRET`

## Development

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch
```
```

**Step 2: Commit**

```bash
git add README.md && git commit -m "docs: add setup and configuration documentation"
```

---

## Task 9: Final Verification

**Step 1: Run all tests**

Run:
```bash
bun test
```
Expected: All tests PASS

**Step 2: Start server and verify endpoints**

Run:
```bash
LINEAR_WEBHOOK_SECRET=test bun run src/server.ts
```

In another terminal:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/status
```

Expected:
- `/health` → "OK"
- `/status` → JSON with `agents` array and `timestamp`

**Step 3: Final commit**

```bash
git add -A && git commit -m "chore: complete initial Amadeus orchestrator implementation"
```

---

## Summary

After completing all tasks, you'll have:

1. **`src/types.ts`** - TypeScript interfaces for Linear payloads and agent state
2. **`src/config.ts`** - Environment-based configuration
3. **`src/signature.ts`** - HMAC signature verification
4. **`src/prompt.ts`** - Prompt builder for Claude agents
5. **`src/orchestrator.ts`** - Agent lifecycle management
6. **`src/server.ts`** - HTTP server with all endpoints
7. **`tests/`** - Comprehensive test coverage
8. **Documentation** - README and .env.example

The server is ready to:
- Receive Linear webhooks
- Spawn Claude Code agents via AgentAPI
- Track agent status
- Route messages to running agents

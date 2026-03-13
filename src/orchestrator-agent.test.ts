// ABOUTME: Tests for the orchestrator agent reconciliation logic.
// ABOUTME: Verifies stall detection, terminal state handling, and state drift reconciliation.

import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { OrchestratorAgent } from "./orchestrator-agent";

// Mock the config module to avoid real env/file access
mock.module("./config", () => ({
  resolveLinearApiKey: async () => "test-api-key",
}));

// Track calls to fetchIssueDetails so we can simulate different Linear states
let mockIssueResponse: any = null;

mock.module("./linear", () => ({
  fetchIssueDetails: async () => mockIssueResponse,
}));

function createMockOrchestrator(agents: any[] = []) {
  const stopped: { key: string; reason?: string }[] = [];
  const stateUpdates: { key: string; state: string }[] = [];

  return {
    getStatus: () => agents.map(a => ({
      key: a.key ?? `proj-${a.issueId}`,
      pid: 1234,
      port: a.port ?? 8001,
      issueId: a.issueId ?? "issue-1",
      issueIdentifier: a.issueIdentifier ?? "ENG-123",
      issueTitle: a.issueTitle ?? "Test issue",
      linearState: a.linearState ?? "Building",
      status: a.status ?? "idle",
      uptime: a.uptime ?? 60000,
      worktreePath: a.worktreePath,
    })),
    stopAgent: async (key: string, reason?: string) => {
      stopped.push({ key, reason });
      // Remove agent from list to simulate stop
      const idx = agents.findIndex(a => (a.key ?? `proj-${a.issueId}`) === key);
      if (idx >= 0) agents.splice(idx, 1);
    },
    updateIssueState: (key: string, state: string) => {
      stateUpdates.push({ key, state });
      const agent = agents.find(a => (a.key ?? `proj-${a.issueId}`) === key);
      if (agent) agent.linearState = state;
    },
    hasAgent: (key: string) => agents.some(a => (a.key ?? `proj-${a.issueId}`) === key),
    _stopped: stopped,
    _stateUpdates: stateUpdates,
  };
}

function createMockPersistence() {
  return {
    saveAgentState: () => {},
    markAgentDead: () => {},
    markAgentAlive: () => {},
    getDeadAgents: () => [],
    getAllAgents: () => [],
    deleteAgent: () => {},
  };
}

function createMockHealthMonitor() {
  return {
    notifyAgentCountChanged: () => {},
    checkAgentHealth: async (port: number) => {
      try {
        const res = await fetch(`http://localhost:${port}/status`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          const data = await res.json();
          return { healthy: true, status: data.status };
        }
      } catch {}
      return { healthy: false, error: "unreachable" };
    },
  };
}

describe("OrchestratorAgent", () => {
  let agent: OrchestratorAgent;

  afterEach(() => {
    agent?.stop();
    mockIssueResponse = null;
  });

  test("starts and stops cleanly", () => {
    const orch = createMockOrchestrator();
    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      reconcileIntervalMs: 60000,
    });

    expect(agent.isRunning()).toBe(false);
    agent.start();
    expect(agent.isRunning()).toBe(true);
    agent.stop();
    expect(agent.isRunning()).toBe(false);
  });

  test("getStats returns correct initial stats", () => {
    const orch = createMockOrchestrator();
    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const stats = agent.getStats();
    expect(stats.running).toBe(false);
    expect(stats.reconcileCount).toBe(0);
    expect(stats.totalTerminated).toBe(0);
    expect(stats.totalStalled).toBe(0);
    expect(stats.trackedAgents).toBe(0);
  });

  test("tick with no agents is a no-op", async () => {
    const orch = createMockOrchestrator([]);
    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const result = await agent.tick();
    expect(result.checked).toBe(0);
    expect(result.terminated).toBe(0);
    expect(result.stalled).toBe(0);
    expect(agent.getStats().reconcileCount).toBe(1);
  });

  test("terminates agent when Linear state is terminal", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Done", type: "completed" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const result = await agent.tick();
    expect(result.terminated).toBe(1);
    expect(orch._stopped.length).toBe(1);
    expect(orch._stopped[0].reason).toBe("done");
  });

  test("terminates agent when state is canceled", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Canceled", type: "canceled" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const result = await agent.tick();
    expect(result.terminated).toBe(1);
    expect(orch._stopped[0].reason).toBe("canceled");
  });

  test("terminates agent when state is inactive (backlog)", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Backlog", type: "backlog" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const result = await agent.tick();
    expect(result.terminated).toBe(1);
    expect(orch._stopped[0].reason).toBe("stopped");
  });

  test("updates agent state when Linear state drifted but still active", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Review", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const result = await agent.tick();
    expect(result.updated).toBe(1);
    expect(result.terminated).toBe(0);
    expect(orch._stateUpdates.length).toBe(1);
    expect(orch._stateUpdates[0].state).toBe("Review");
  });

  test("detects stalled agents after timeout", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    // Issue still active
    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Building", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      stallTimeoutMs: 1, // 1ms for testing - everything will be stalled
    });

    // First tick initializes snapshot
    await agent.tick();
    // Small delay so stall timeout triggers
    await Bun.sleep(5);
    // Second tick should detect stall
    const result = await agent.tick();
    expect(result.stalled).toBe(1);
    expect(agent.getStats().totalStalled).toBe(1);
  });

  test("stall warning only fires once per agent", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Building", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      stallTimeoutMs: 1,
    });

    await agent.tick();
    await Bun.sleep(5);
    const result1 = await agent.tick();
    expect(result1.stalled).toBe(1);

    // Third tick - stall should not fire again
    const result2 = await agent.tick();
    expect(result2.stalled).toBe(0);
  });

  test("does not flag stall when agentapi reports running status", async () => {
    // Use a port we can intercept with a mock server
    const mockServer = Bun.serve({
      port: 0,
      fetch: () => Response.json({ status: "running" }),
    });
    const port = mockServer.port;

    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building", port }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Building", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      stallTimeoutMs: 1,
    });

    // First tick initializes snapshot
    await agent.tick();
    await Bun.sleep(5);
    // Second tick — agent is "running" so should NOT be stalled
    const result = await agent.tick();
    expect(result.stalled).toBe(0);

    mockServer.stop();
  });

  test("does not flag stall when worktree has dirty files", async () => {
    // Create a temporary git repo to simulate a worktree with dirty files
    const tmpDir = await Bun.$`mktemp -d`.quiet().text();
    const worktreePath = tmpDir.trim();
    await Bun.$`git -C ${worktreePath} init && git -C ${worktreePath} commit --allow-empty -m "init"`.quiet();
    // Create a dirty file
    await Bun.$`echo "dirty" > ${worktreePath}/dirty.txt`.quiet();

    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building", worktreePath }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Building", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      stallTimeoutMs: 1,
    });

    await agent.tick();
    await Bun.sleep(5);
    const result = await agent.tick();
    expect(result.stalled).toBe(0);

    // Cleanup
    await Bun.$`rm -rf ${worktreePath}`.quiet();
  });

  test("flags stall when worktree is clean and agentapi is stable", async () => {
    // Create a temporary git repo with no dirty files and an old commit
    const tmpDir = await Bun.$`mktemp -d`.quiet().text();
    const worktreePath = tmpDir.trim();
    await Bun.$`git -C ${worktreePath} init`.quiet();
    // Backdate the commit so git log --since doesn't find it
    await Bun.$`GIT_AUTHOR_DATE="2020-01-01T00:00:00" GIT_COMMITTER_DATE="2020-01-01T00:00:00" git -C ${worktreePath} commit --allow-empty -m "init"`.env({ ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00", GIT_COMMITTER_DATE: "2020-01-01T00:00:00" }).quiet();

    // Mock agentapi returning "stable"
    const mockServer = Bun.serve({
      port: 0,
      fetch: () => Response.json({ status: "stable" }),
    });
    const port = mockServer.port;

    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building", port, worktreePath }];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Building", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      stallTimeoutMs: 1,
    });

    await agent.tick();
    await Bun.sleep(5);
    const result = await agent.tick();
    expect(result.stalled).toBe(1);

    mockServer.stop();
    await Bun.$`rm -rf ${worktreePath}`.quiet();
  });

  test("handles API errors gracefully without stopping agents", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);

    // Simulate API returning null (error case)
    mockIssueResponse = null;

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    const result = await agent.tick();
    expect(result.checked).toBe(1);
    expect(result.terminated).toBe(0);
    expect(orch._stopped.length).toBe(0);
  });

  test("cleans up snapshots for removed agents", async () => {
    const agents = [
      { issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" },
      { issueId: "issue-2", issueIdentifier: "ENG-456", linearState: "Building" },
    ];
    const orch = createMockOrchestrator(agents);

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Building", type: "started" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
    });

    // First tick - both agents tracked
    await agent.tick();
    expect(agent.getStats().trackedAgents).toBe(2);

    // Remove one agent externally
    agents.splice(1, 1);

    // Second tick - should clean up the removed agent's snapshot
    await agent.tick();
    expect(agent.getStats().trackedAgents).toBe(1);
  });

  test("calls onAgentReconciled callback on termination", async () => {
    const agents = [{ issueId: "issue-1", issueIdentifier: "ENG-123", linearState: "Building" }];
    const orch = createMockOrchestrator(agents);
    const reconciled: { id: string; reason: string }[] = [];

    mockIssueResponse = {
      id: "issue-1",
      identifier: "ENG-123",
      title: "Test",
      state: { id: "s1", name: "Done", type: "completed" },
    };

    agent = new OrchestratorAgent({
      orchestrator: orch as any,
      persistence: createMockPersistence() as any,
      healthMonitor: createMockHealthMonitor() as any,
      onAgentReconciled: (id, reason) => reconciled.push({ id, reason }),
    });

    await agent.tick();
    expect(reconciled.length).toBe(1);
    expect(reconciled[0].id).toBe("ENG-123");
    expect(reconciled[0].reason).toContain("terminal");
  });
});

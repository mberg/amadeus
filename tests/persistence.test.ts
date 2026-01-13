// ABOUTME: Tests for the SQLite persistence layer for agent state.
// ABOUTME: Verifies agent state persistence, recovery, and lifecycle tracking.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { AgentPersistence, type PersistedAgentState, type PersistedCompletedTask } from "../src/persistence";
import { unlink } from "node:fs/promises";

describe("AgentPersistence", () => {
  let persistence: AgentPersistence;
  const testDbPath = "/tmp/test-amadeus-agents.db";

  beforeEach(async () => {
    // Clean up any existing test database
    try {
      await unlink(testDbPath);
    } catch {
      // File doesn't exist, that's fine
    }
    persistence = new AgentPersistence(testDbPath);
  });

  afterEach(async () => {
    persistence.close();
    try {
      await unlink(testDbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("saveAgentState", () => {
    it("saves agent state to database", () => {
      const state: PersistedAgentState = {
        key: "TEST-issue-123",
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        projectPath: "/tmp/test-project",
        worktreePath: "/tmp/worktrees/TEST-1",
        linearState: "Building",
        port: 8001,
        status: "alive",
        lastHeartbeat: new Date(),
      };

      persistence.saveAgentState(state);

      const loaded = persistence.getAgentByIssueId("issue-123");
      expect(loaded).not.toBeNull();
      expect(loaded!.key).toBe("TEST-issue-123");
      expect(loaded!.issueIdentifier).toBe("TEST-1");
      expect(loaded!.status).toBe("alive");
    });

    it("updates existing agent state", () => {
      const state: PersistedAgentState = {
        key: "TEST-issue-123",
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        projectPath: "/tmp/test-project",
        port: 8001,
        status: "alive",
        lastHeartbeat: new Date(),
      };

      persistence.saveAgentState(state);
      persistence.saveAgentState({ ...state, linearState: "Review" });

      const loaded = persistence.getAgentByIssueId("issue-123");
      expect(loaded!.linearState).toBe("Review");
    });
  });

  describe("getAgentByIssueId", () => {
    it("returns null for non-existent issue", () => {
      const result = persistence.getAgentByIssueId("non-existent");
      expect(result).toBeNull();
    });

    it("returns agent state for existing issue", () => {
      const state: PersistedAgentState = {
        key: "TEST-issue-456",
        issueId: "issue-456",
        issueIdentifier: "TEST-2",
        issueTitle: "Another Issue",
        projectPath: "/tmp/test-project",
        port: 8002,
        status: "alive",
        lastHeartbeat: new Date(),
      };

      persistence.saveAgentState(state);

      const loaded = persistence.getAgentByIssueId("issue-456");
      expect(loaded).not.toBeNull();
      expect(loaded!.issueIdentifier).toBe("TEST-2");
    });
  });

  describe("markAgentDead", () => {
    it("marks an agent as dead", () => {
      const state: PersistedAgentState = {
        key: "TEST-issue-123",
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        projectPath: "/tmp/test-project",
        port: 8001,
        status: "alive",
        lastHeartbeat: new Date(),
      };

      persistence.saveAgentState(state);
      persistence.markAgentDead("issue-123");

      const loaded = persistence.getAgentByIssueId("issue-123");
      expect(loaded!.status).toBe("dead");
    });

    it("does not crash for non-existent agent", () => {
      expect(() => persistence.markAgentDead("non-existent")).not.toThrow();
    });
  });

  describe("getDeadAgents", () => {
    it("returns empty array when no dead agents", () => {
      const result = persistence.getDeadAgents();
      expect(result).toEqual([]);
    });

    it("returns only dead agents", () => {
      persistence.saveAgentState({
        key: "TEST-issue-1",
        issueId: "issue-1",
        issueIdentifier: "TEST-1",
        issueTitle: "Issue 1",
        projectPath: "/tmp/test",
        port: 8001,
        status: "alive",
        lastHeartbeat: new Date(),
      });

      persistence.saveAgentState({
        key: "TEST-issue-2",
        issueId: "issue-2",
        issueIdentifier: "TEST-2",
        issueTitle: "Issue 2",
        projectPath: "/tmp/test",
        port: 8002,
        status: "dead",
        lastHeartbeat: new Date(),
      });

      const dead = persistence.getDeadAgents();
      expect(dead.length).toBe(1);
      expect(dead[0].issueIdentifier).toBe("TEST-2");
    });
  });

  describe("deleteAgent", () => {
    it("removes agent from database", () => {
      persistence.saveAgentState({
        key: "TEST-issue-123",
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        projectPath: "/tmp/test",
        port: 8001,
        status: "alive",
        lastHeartbeat: new Date(),
      });

      persistence.deleteAgent("issue-123");

      const loaded = persistence.getAgentByIssueId("issue-123");
      expect(loaded).toBeNull();
    });
  });

  describe("getAllAgents", () => {
    it("returns all agents regardless of status", () => {
      persistence.saveAgentState({
        key: "TEST-issue-1",
        issueId: "issue-1",
        issueIdentifier: "TEST-1",
        issueTitle: "Issue 1",
        projectPath: "/tmp/test",
        port: 8001,
        status: "alive",
        lastHeartbeat: new Date(),
      });

      persistence.saveAgentState({
        key: "TEST-issue-2",
        issueId: "issue-2",
        issueIdentifier: "TEST-2",
        issueTitle: "Issue 2",
        projectPath: "/tmp/test",
        port: 8002,
        status: "dead",
        lastHeartbeat: new Date(),
      });

      const all = persistence.getAllAgents();
      expect(all.length).toBe(2);
    });
  });

  describe("saveCompletedTask", () => {
    it("saves completed task to database", () => {
      const task: PersistedCompletedTask = {
        key: "TEST-issue-123",
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        completedAt: new Date(),
        completionReason: "done",
        finalLinearState: "Done",
        duration: 3600000,
      };

      persistence.saveCompletedTask(task);

      const tasks = persistence.getCompletedTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0].issueIdentifier).toBe("TEST-1");
      expect(tasks[0].completionReason).toBe("done");
    });

    it("saves task without final state", () => {
      const task: PersistedCompletedTask = {
        key: "TEST-issue-456",
        issueId: "issue-456",
        issueIdentifier: "TEST-2",
        issueTitle: "Another Issue",
        completedAt: new Date(),
        completionReason: "stopped",
        duration: 1800000,
      };

      persistence.saveCompletedTask(task);

      const tasks = persistence.getCompletedTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0].finalLinearState).toBeUndefined();
    });
  });

  describe("getCompletedTasks", () => {
    it("returns empty array when no completed tasks", () => {
      const tasks = persistence.getCompletedTasks();
      expect(tasks).toEqual([]);
    });

    it("returns tasks ordered by completed_at descending", () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 60000);

      persistence.saveCompletedTask({
        key: "TEST-issue-1",
        issueId: "issue-1",
        issueIdentifier: "TEST-1",
        issueTitle: "First Issue",
        completedAt: earlier,
        completionReason: "done",
        duration: 1000,
      });

      persistence.saveCompletedTask({
        key: "TEST-issue-2",
        issueId: "issue-2",
        issueIdentifier: "TEST-2",
        issueTitle: "Second Issue",
        completedAt: now,
        completionReason: "stopped",
        duration: 2000,
      });

      const tasks = persistence.getCompletedTasks();
      expect(tasks.length).toBe(2);
      expect(tasks[0].issueIdentifier).toBe("TEST-2"); // More recent first
      expect(tasks[1].issueIdentifier).toBe("TEST-1");
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        persistence.saveCompletedTask({
          key: `TEST-issue-${i}`,
          issueId: `issue-${i}`,
          issueIdentifier: `TEST-${i}`,
          issueTitle: `Issue ${i}`,
          completedAt: new Date(),
          completionReason: "done",
          duration: 1000,
        });
      }

      const tasks = persistence.getCompletedTasks(3);
      expect(tasks.length).toBe(3);
    });

    it("respects offset parameter", () => {
      for (let i = 0; i < 5; i++) {
        persistence.saveCompletedTask({
          key: `TEST-issue-${i}`,
          issueId: `issue-${i}`,
          issueIdentifier: `TEST-${i}`,
          issueTitle: `Issue ${i}`,
          completedAt: new Date(Date.now() + i * 1000), // Different times for ordering
          completionReason: "done",
          duration: 1000,
        });
      }

      const tasks = persistence.getCompletedTasks(2, 2);
      expect(tasks.length).toBe(2);
    });
  });

  describe("getCompletedTasksCount", () => {
    it("returns 0 when no completed tasks", () => {
      const count = persistence.getCompletedTasksCount();
      expect(count).toBe(0);
    });

    it("returns correct count of completed tasks", () => {
      for (let i = 0; i < 3; i++) {
        persistence.saveCompletedTask({
          key: `TEST-issue-${i}`,
          issueId: `issue-${i}`,
          issueIdentifier: `TEST-${i}`,
          issueTitle: `Issue ${i}`,
          completedAt: new Date(),
          completionReason: "done",
          duration: 1000,
        });
      }

      const count = persistence.getCompletedTasksCount();
      expect(count).toBe(3);
    });
  });
});

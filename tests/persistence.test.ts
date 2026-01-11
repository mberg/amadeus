// ABOUTME: Tests for the SQLite persistence layer for agent state.
// ABOUTME: Verifies agent state persistence, recovery, and lifecycle tracking.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { AgentPersistence, type PersistedAgentState } from "../src/persistence";
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
});

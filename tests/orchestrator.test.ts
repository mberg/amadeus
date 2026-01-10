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

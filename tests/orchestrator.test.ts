// ABOUTME: Tests for the Claude orchestrator agent management.
// ABOUTME: Tests agent spawning, stopping, and status tracking.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { ClaudeOrchestrator } from "../src/orchestrator";
import type { LinearIssue, AgentStatus } from "../src/types";
import type { AgentDeathInfo } from "../src/orchestrator";

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

    describe("with agentName label filtering", () => {
      it("returns false when agentName is set but issue has no matching label", () => {
        orchestrator = new ClaudeOrchestrator({
          projectPaths: { TEST: "/tmp/test-project" },
          triggerStates: ["Scoping"],
          agentName: "amadeus",
        });

        const issue: LinearIssue = {
          id: "issue-123",
          identifier: "TEST-1",
          title: "Test",
          state: { id: "state-1", name: "Scoping" },
          team: { key: "TEST" },
          labels: [{ name: "bug" }, { name: "frontend" }],
        };

        expect(orchestrator.shouldStartAgent(issue)).toBe(false);
      });

      it("returns false when agentName is set and issue has no labels", () => {
        orchestrator = new ClaudeOrchestrator({
          projectPaths: { TEST: "/tmp/test-project" },
          triggerStates: ["Scoping"],
          agentName: "amadeus",
        });

        const issue: LinearIssue = {
          id: "issue-123",
          identifier: "TEST-1",
          title: "Test",
          state: { id: "state-1", name: "Scoping" },
          team: { key: "TEST" },
        };

        expect(orchestrator.shouldStartAgent(issue)).toBe(false);
      });

      it("returns true when agentName matches label exactly", () => {
        orchestrator = new ClaudeOrchestrator({
          projectPaths: { TEST: "/tmp/test-project" },
          triggerStates: ["Scoping"],
          agentName: "amadeus",
        });

        const issue: LinearIssue = {
          id: "issue-123",
          identifier: "TEST-1",
          title: "Test",
          state: { id: "state-1", name: "Scoping" },
          team: { key: "TEST" },
          labels: [{ name: "bug" }, { name: "amadeus" }],
        };

        expect(orchestrator.shouldStartAgent(issue)).toBe(true);
      });

      it("returns true when agentName matches label case-insensitively", () => {
        orchestrator = new ClaudeOrchestrator({
          projectPaths: { TEST: "/tmp/test-project" },
          triggerStates: ["Scoping"],
          agentName: "Amadeus",
        });

        const issue: LinearIssue = {
          id: "issue-123",
          identifier: "TEST-1",
          title: "Test",
          state: { id: "state-1", name: "Scoping" },
          team: { key: "TEST" },
          labels: [{ name: "AMADEUS" }],
        };

        expect(orchestrator.shouldStartAgent(issue)).toBe(true);
      });

      it("still requires state match even with matching label", () => {
        orchestrator = new ClaudeOrchestrator({
          projectPaths: { TEST: "/tmp/test-project" },
          triggerStates: ["Scoping"],
          agentName: "amadeus",
        });

        const issue: LinearIssue = {
          id: "issue-123",
          identifier: "TEST-1",
          title: "Test",
          state: { id: "state-1", name: "Backlog" },
          team: { key: "TEST" },
          labels: [{ name: "amadeus" }],
        };

        expect(orchestrator.shouldStartAgent(issue)).toBe(false);
      });
    });
  });

  describe("getStatus", () => {
    it("returns empty array when no agents running", () => {
      expect(orchestrator.getStatus()).toEqual([]);
    });

    it("AgentStatus includes pid field", () => {
      // Type-level test: verify AgentStatus has pid field
      const mockStatus: AgentStatus = {
        key: "test-key",
        port: 5000,
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        status: "idle",
        uptime: 1000,
        pid: 12345,
      };

      expect(mockStatus.pid).toBe(12345);
    });

    it("AgentStatus includes memoryMB field", () => {
      // Type-level test: verify AgentStatus has memoryMB field
      const mockStatus: AgentStatus = {
        key: "test-key",
        port: 5000,
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        status: "idle",
        uptime: 1000,
        pid: 12345,
        memoryMB: 128.5,
      };

      expect(mockStatus.memoryMB).toBe(128.5);
    });
  });

  describe("getAgentKey", () => {
    it("uses project name when available", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        team: { key: "TEST" },
        project: { id: "proj-1", name: "Amadeus" },
      };

      expect(orchestrator.getAgentKey(issue)).toBe("Amadeus-issue-123");
    });

    it("falls back to team key when no project", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        team: { key: "TEST" },
      };

      expect(orchestrator.getAgentKey(issue)).toBe("TEST-issue-123");
    });

    it("uses DEFAULT when no project or team", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
      };

      expect(orchestrator.getAgentKey(issue)).toBe("DEFAULT-issue-123");
    });
  });

  describe("updateIssueState", () => {
    it("does not crash when updating non-existent agent", () => {
      expect(() => {
        orchestrator.updateIssueState("non-existent-key", "Building");
      }).not.toThrow();
    });
  });

  describe("onAgentDeath callback", () => {
    it("accepts onAgentDeath callback in config", () => {
      const deathCallback = (_info: AgentDeathInfo) => {};
      const orch = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Scoping"],
        onAgentDeath: deathCallback,
      });

      expect(orch).toBeDefined();
    });

    it("getAgentDeathHandler returns the configured callback", () => {
      const deathCallback = (_info: AgentDeathInfo) => {};
      const orch = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Scoping"],
        onAgentDeath: deathCallback,
      });

      expect(orch.getAgentDeathHandler()).toBe(deathCallback);
    });

    it("getAgentDeathHandler returns undefined when not configured", () => {
      expect(orchestrator.getAgentDeathHandler()).toBeUndefined();
    });
  });

  describe("getAgentsInReviewState", () => {
    it("returns empty array when no agents running", () => {
      expect(orchestrator.getAgentsInReviewState()).toEqual([]);
    });
  });

  describe("pending message buffer", () => {
    it("hasPendingMessages returns false when no pending messages", () => {
      expect(orchestrator.hasPendingMessages("test-key")).toBe(false);
    });

    it("getPendingMessageCount returns 0 when no pending messages", () => {
      expect(orchestrator.getPendingMessageCount("test-key")).toBe(0);
    });

    it("bufferMessage adds message to pending queue", () => {
      orchestrator.bufferMessage("test-key", "Hello world");
      expect(orchestrator.hasPendingMessages("test-key")).toBe(true);
      expect(orchestrator.getPendingMessageCount("test-key")).toBe(1);
    });

    it("bufferMessage maintains FIFO order", () => {
      orchestrator.bufferMessage("test-key", "First message");
      orchestrator.bufferMessage("test-key", "Second message");
      orchestrator.bufferMessage("test-key", "Third message");
      expect(orchestrator.getPendingMessageCount("test-key")).toBe(3);

      const messages = orchestrator.getPendingMessages("test-key");
      expect(messages[0].message).toBe("First message");
      expect(messages[1].message).toBe("Second message");
      expect(messages[2].message).toBe("Third message");
    });

    it("clearPendingMessages removes all pending messages for an agent", () => {
      orchestrator.bufferMessage("test-key", "Message 1");
      orchestrator.bufferMessage("test-key", "Message 2");
      expect(orchestrator.getPendingMessageCount("test-key")).toBe(2);

      orchestrator.clearPendingMessages("test-key");
      expect(orchestrator.hasPendingMessages("test-key")).toBe(false);
      expect(orchestrator.getPendingMessageCount("test-key")).toBe(0);
    });

    it("pending messages are isolated per agent key", () => {
      orchestrator.bufferMessage("agent-1", "Message for agent 1");
      orchestrator.bufferMessage("agent-2", "Message for agent 2");

      expect(orchestrator.getPendingMessageCount("agent-1")).toBe(1);
      expect(orchestrator.getPendingMessageCount("agent-2")).toBe(1);

      orchestrator.clearPendingMessages("agent-1");
      expect(orchestrator.hasPendingMessages("agent-1")).toBe(false);
      expect(orchestrator.hasPendingMessages("agent-2")).toBe(true);
    });
  });

  describe("isAwaitingFeedback", () => {
    it("returns true when issue is in Feedback Needed state with agent label", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Planning"],
        agentName: "Amadeus",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Feedback Needed" },
        team: { key: "TEST" },
        labels: [{ name: "Amadeus" }],
      };

      expect(orchestrator.isAwaitingFeedback(issue)).toBe(true);
    });

    it("returns false when issue is in Feedback Needed state without agent label", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Planning"],
        agentName: "Amadeus",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Feedback Needed" },
        team: { key: "TEST" },
        labels: [{ name: "bug" }],
      };

      expect(orchestrator.isAwaitingFeedback(issue)).toBe(false);
    });

    it("returns false when issue is in different state with agent label", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Planning"],
        agentName: "Amadeus",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Planning" },
        team: { key: "TEST" },
        labels: [{ name: "Amadeus" }],
      };

      expect(orchestrator.isAwaitingFeedback(issue)).toBe(false);
    });

    it("is case-insensitive for state name matching", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Planning"],
        agentName: "Amadeus",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "FEEDBACK NEEDED" },
        team: { key: "TEST" },
        labels: [{ name: "Amadeus" }],
      };

      expect(orchestrator.isAwaitingFeedback(issue)).toBe(true);
    });

    it("is case-insensitive for agent label matching", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Planning"],
        agentName: "Amadeus",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Feedback Needed" },
        team: { key: "TEST" },
        labels: [{ name: "amadeus" }],
      };

      expect(orchestrator.isAwaitingFeedback(issue)).toBe(true);
    });

    it("returns true regardless of trigger states config", () => {
      // This ensures the feedback check is independent of trigger states
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Scoping", "Ready to Build"],
        agentName: "Amadeus",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Feedback Needed" },
        team: { key: "TEST" },
        labels: [{ name: "Amadeus" }],
      };

      expect(orchestrator.isAwaitingFeedback(issue)).toBe(true);
    });
  });

  describe("resolveAgentType", () => {
    it("returns claude by default when no codex label", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
        labels: [{ name: "bug" }],
      };

      expect(orchestrator.resolveAgentType(issue)).toBe("claude");
    });

    it("returns codex when issue has Codex label", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
        labels: [{ name: "Codex" }],
      };

      expect(orchestrator.resolveAgentType(issue)).toBe("codex");
    });

    it("returns codex case-insensitively", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
        labels: [{ name: "CODEX" }],
      };

      expect(orchestrator.resolveAgentType(issue)).toBe("codex");
    });

    it("returns claude when no labels", () => {
      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
      };

      expect(orchestrator.resolveAgentType(issue)).toBe("claude");
    });

    it("respects defaultAgentType config", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Scoping"],
        defaultAgentType: "codex",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
      };

      expect(orchestrator.resolveAgentType(issue)).toBe("codex");
    });

    it("label overrides defaultAgentType", () => {
      orchestrator = new ClaudeOrchestrator({
        projectPaths: { TEST: "/tmp/test-project" },
        triggerStates: ["Scoping"],
        defaultAgentType: "codex",
      });

      const issue: LinearIssue = {
        id: "issue-123",
        identifier: "TEST-1",
        title: "Test",
        state: { id: "state-1", name: "Scoping" },
        team: { key: "TEST" },
        labels: [{ name: "Claude" }],
      };

      expect(orchestrator.resolveAgentType(issue)).toBe("claude");
    });
  });

  describe("ensureCodexTrust", () => {
    let origHome: string | undefined;
    let tmpHome: string;

    beforeEach(async () => {
      origHome = process.env.HOME;
      tmpHome = `/tmp/codex-trust-test-${Math.floor(performance.now() * 1000)}`;
      process.env.HOME = tmpHome;
    });

    afterEach(async () => {
      process.env.HOME = origHome;
      await Bun.$`rm -rf ${tmpHome}`.quiet().nothrow();
    });

    const configPath = () => `${process.env.HOME}/.codex/config.toml`;

    it("creates a trusted entry for the directory", async () => {
      await (orchestrator as any).ensureCodexTrust("/tmp/wt/REC-1");
      const content = await Bun.file(configPath()).text();
      expect(content).toContain('[projects."/tmp/wt/REC-1"]');
      expect(content).toContain('trust_level = "trusted"');
    });

    it("is idempotent for the same directory", async () => {
      await (orchestrator as any).ensureCodexTrust("/tmp/wt/REC-1");
      await (orchestrator as any).ensureCodexTrust("/tmp/wt/REC-1");
      const content = await Bun.file(configPath()).text();
      const matches = content.match(/\[projects\."\/tmp\/wt\/REC-1"\]/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it("preserves existing config and appends new entries", async () => {
      await Bun.write(configPath(), '[projects."/existing"]\ntrust_level = "trusted"\n');
      await (orchestrator as any).ensureCodexTrust("/tmp/wt/REC-2");
      const content = await Bun.file(configPath()).text();
      expect(content).toContain('[projects."/existing"]');
      expect(content).toContain('[projects."/tmp/wt/REC-2"]');
    });
  });
});

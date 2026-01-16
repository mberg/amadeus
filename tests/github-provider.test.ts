// ABOUTME: Tests for the GitHub issue tracking provider.
// ABOUTME: Tests webhook verification, parsing, and issue operations.

import { describe, it, expect, beforeEach } from "bun:test";
import { GitHubProvider } from "../src/providers/github";
import type { ProviderConfig, ParsedIssue, ParsedComment } from "../src/providers/types";

describe("GitHubProvider", () => {
  let provider: GitHubProvider;
  const testConfig: ProviderConfig = {
    type: "github",
    realmName: "test-realm",
    agentName: "TestBot",
    triggerStates: ["Planning"],
    githubOwner: "testowner",
    githubRepo: "testrepo",
    githubProjectNumber: 1,
    githubToken: "test-token",
    githubWebhookSecret: "test-secret",
  };

  beforeEach(() => {
    provider = new GitHubProvider(testConfig);
  });

  describe("constructor", () => {
    it("initializes with correct config", () => {
      expect(provider.type).toBe("github");
      expect(provider.realmName).toBe("test-realm");
      expect(provider.agentName).toBe("TestBot");
    });

    it("throws if type is not github", () => {
      expect(() => new GitHubProvider({ ...testConfig, type: "linear" as "github" }))
        .toThrow("GitHubProvider requires type 'github'");
    });

    it("throws if required fields are missing", () => {
      expect(() => new GitHubProvider({ ...testConfig, githubOwner: undefined }))
        .toThrow("GitHubProvider requires githubOwner");
      expect(() => new GitHubProvider({ ...testConfig, githubRepo: undefined }))
        .toThrow("GitHubProvider requires githubRepo");
      expect(() => new GitHubProvider({ ...testConfig, githubToken: undefined }))
        .toThrow("GitHubProvider requires githubToken");
      expect(() => new GitHubProvider({ ...testConfig, githubWebhookSecret: undefined }))
        .toThrow("GitHubProvider requires githubWebhookSecret");
    });
  });

  describe("verifyWebhook", () => {
    it("returns false for null signature", async () => {
      const result = await provider.verifyWebhook("test payload", null);
      expect(result).toBe(false);
    });

    it("returns false for invalid signature format", async () => {
      const result = await provider.verifyWebhook("test payload", "invalid-signature");
      expect(result).toBe(false);
    });

    it("verifies correct signature", async () => {
      const payload = '{"action":"opened","issue":{"id":1}}';
      // Generate correct signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode("test-secret"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const signature = "sha256=" + Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const result = await provider.verifyWebhook(payload, signature);
      expect(result).toBe(true);
    });

    it("rejects incorrect signature", async () => {
      const result = await provider.verifyWebhook(
        '{"action":"opened"}',
        "sha256=0000000000000000000000000000000000000000000000000000000000000000"
      );
      expect(result).toBe(false);
    });
  });

  describe("parseWebhook", () => {
    it("parses issue opened webhook", () => {
      const payload = JSON.stringify({
        action: "opened",
        issue: {
          id: 123,
          number: 45,
          title: "Test Issue",
          body: "Test description",
          state: "open",
          labels: [{ name: "bug" }, { name: "TestBot" }],
          assignee: { id: 1, login: "testuser" },
          user: { id: 2, login: "creator" },
        },
        repository: {
          name: "testrepo",
          full_name: "testowner/testrepo",
          owner: { id: 100, login: "testowner" },
        },
      });

      const result = provider.parseWebhook(payload);
      expect(result.type).toBe("issue");
      if (result.type === "issue") {
        expect(result.action).toBe("create");
        expect(result.issue.id).toBe("123");
        expect(result.issue.identifier).toBe("#45");
        expect(result.issue.title).toBe("Test Issue");
        expect(result.issue.description).toBe("Test description");
        expect(result.issue.labels).toHaveLength(2);
      }
    });

    it("parses issue comment webhook", () => {
      const payload = JSON.stringify({
        action: "created",
        comment: {
          id: 456,
          body: "This is a comment",
          user: { id: 1, login: "commenter" },
          created_at: "2024-01-01T00:00:00Z",
        },
        issue: {
          id: 123,
          number: 45,
          title: "Test Issue",
          body: "Test description",
          state: "open",
          labels: [],
        },
        repository: {
          name: "testrepo",
          full_name: "testowner/testrepo",
          owner: { id: 100, login: "testowner" },
        },
      });

      const result = provider.parseWebhook(payload);
      expect(result.type).toBe("comment");
      if (result.type === "comment") {
        expect(result.action).toBe("create");
        expect(result.comment.id).toBe("456");
        expect(result.comment.body).toBe("This is a comment");
        expect(result.comment.author?.name).toBe("commenter");
      }
    });

    it("returns unknown for unrecognized webhook", () => {
      const payload = JSON.stringify({
        action: "push",
        commits: [],
      });

      const result = provider.parseWebhook(payload);
      expect(result.type).toBe("unknown");
    });
  });

  describe("issue operations", () => {
    const mockIssue: ParsedIssue = {
      id: "123",
      identifier: "#45",
      title: "Test Issue",
      description: "Test description",
      state: { id: "planning", name: "Planning" },
      labels: [{ name: "TestBot" }, { name: "status:planning" }],
      teamKey: "TESTREPO",
      projectName: "testrepo",
      raw: {},
    };

    it("generates correct agent key", () => {
      const key = provider.getAgentKey(mockIssue);
      expect(key).toBe("testrepo-123");
    });

    it("shouldStartAgent returns true when conditions met", () => {
      const result = provider.shouldStartAgent(mockIssue);
      expect(result).toBe(true);
    });

    it("shouldStartAgent returns false without agent label", () => {
      const issueWithoutLabel: ParsedIssue = {
        ...mockIssue,
        labels: [{ name: "bug" }],
      };
      const result = provider.shouldStartAgent(issueWithoutLabel);
      expect(result).toBe(false);
    });

    it("shouldTerminateAgent returns true for closed issues", () => {
      const closedIssue: ParsedIssue = {
        ...mockIssue,
        state: { id: "done", name: "Done", type: "completed" },
      };
      const result = provider.shouldTerminateAgent(closedIssue);
      expect(result).toBe(true);
    });

    it("isAwaitingFeedback returns true for feedback-needed label", () => {
      const feedbackIssue: ParsedIssue = {
        ...mockIssue,
        labels: [{ name: "TestBot" }, { name: "status:feedback-needed" }],
        state: { id: "feedback-needed", name: "Feedback Needed" },
      };
      const result = provider.isAwaitingFeedback(feedbackIssue);
      expect(result).toBe(true);
    });

    it("isDraft returns true for draft label", () => {
      const draftIssue: ParsedIssue = {
        ...mockIssue,
        labels: [{ name: "draft" }],
      };
      const result = provider.isDraft(draftIssue);
      expect(result).toBe(true);
    });

    it("getCompletionReason returns correct values", () => {
      expect(provider.getCompletionReason({
        ...mockIssue,
        state: { id: "done", name: "Done", type: "completed" },
      })).toBe("done");

      expect(provider.getCompletionReason({
        ...mockIssue,
        labels: [{ name: "wontfix" }],
      })).toBe("canceled");

      expect(provider.getCompletionReason({
        ...mockIssue,
        labels: [{ name: "backlog" }],
      })).toBe("backlog");

      expect(provider.getCompletionReason(mockIssue)).toBe("stopped");
    });
  });

  describe("isBotComment", () => {
    const mockComment: ParsedComment = {
      id: "1",
      body: "This is a test comment",
      issueId: "123",
      issue: {
        id: "123",
        identifier: "#45",
        title: "Test",
        raw: {},
      },
      author: { id: "1", name: "user" },
      createdAt: "2024-01-01T00:00:00Z",
      raw: {},
    };

    it("detects bot comment by prefix", () => {
      const botComment: ParsedComment = {
        ...mockComment,
        body: "**🤖 TestBot:** This is a bot message",
      };
      expect(provider.isBotComment(botComment)).toBe(true);
    });

    it("detects bot comment by [bot] suffix", () => {
      const botComment: ParsedComment = {
        ...mockComment,
        author: { id: "1", name: "github-actions[bot]" },
      };
      expect(provider.isBotComment(botComment)).toBe(true);
    });

    it("returns false for regular user comments", () => {
      expect(provider.isBotComment(mockComment)).toBe(false);
    });
  });

  describe("getWorkflowStates", () => {
    it("returns correct state names", () => {
      const states = provider.getWorkflowStates();
      expect(states.planning).toBe("Planning");
      expect(states.feedbackNeeded).toBe("Feedback Needed");
      expect(states.building).toBe("Building");
      expect(states.review).toBe("Review");
      expect(states.done).toBe("Done");
    });
  });

  describe("getAgentEnv", () => {
    it("returns correct environment variables", () => {
      const env = provider.getAgentEnv();
      expect(env.GH_TOKEN).toBe("test-token");
      expect(env.GITHUB_REPOSITORY).toBe("testowner/testrepo");
    });
  });

  describe("buildPrompt", () => {
    const mockIssue: ParsedIssue = {
      id: "123",
      identifier: "#45",
      title: "Test Issue",
      description: "Fix the bug",
      state: { id: "planning", name: "Planning" },
      labels: [{ name: "bug" }],
      teamKey: "TESTREPO",
      raw: {},
    };

    it("includes issue details in prompt", () => {
      const prompt = provider.buildPrompt(mockIssue);
      expect(prompt).toContain("#45 - Test Issue");
      expect(prompt).toContain("testowner/testrepo");
      expect(prompt).toContain("Fix the bug");
      expect(prompt).toContain("gh issue comment 45");
    });

    it("includes status labels in prompt", () => {
      const prompt = provider.buildPrompt(mockIssue);
      expect(prompt).toContain("status:planning");
      expect(prompt).toContain("status:feedback-needed");
      expect(prompt).toContain("status:building");
      expect(prompt).toContain("status:review");
    });
  });

  describe("buildCommentPrompt", () => {
    it("includes comment body and author", () => {
      const comment: ParsedComment = {
        id: "1",
        body: "Please fix this",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "#45",
          title: "Test",
          raw: {},
        },
        author: { id: "1", name: "reviewer" },
        createdAt: "2024-01-01T00:00:00Z",
        raw: {},
      };

      const prompt = provider.buildCommentPrompt(comment);
      expect(prompt).toContain("New Comment from reviewer");
      expect(prompt).toContain("Please fix this");
    });
  });
});

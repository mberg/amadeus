// ABOUTME: Tests for provider type adapters.
// ABOUTME: Tests conversion between provider types and orchestrator types.

import { describe, it, expect } from "bun:test";
import { toLinearIssue, toLinearComment } from "../src/providers/adapters";
import type { ParsedIssue, ParsedComment } from "../src/providers/types";

describe("Provider Adapters", () => {
  describe("toLinearIssue", () => {
    it("converts ParsedIssue to LinearIssue", () => {
      const parsed: ParsedIssue = {
        id: "123",
        identifier: "#45",
        title: "Test Issue",
        description: "Test description",
        priority: 2,
        state: { id: "planning", name: "Planning", type: "started" },
        assignee: { id: "user-1" },
        labels: [{ name: "bug" }, { name: "urgent" }],
        teamKey: "REPO",
        projectName: "myproject",
        raw: { original: "data" },
      };

      const result = toLinearIssue(parsed);

      expect(result.id).toBe("123");
      expect(result.identifier).toBe("#45");
      expect(result.title).toBe("Test Issue");
      expect(result.description).toBe("Test description");
      expect(result.priority).toBe(2);
      expect(result.state).toEqual({ id: "planning", name: "Planning", type: "started" });
      expect(result.assignee).toEqual({ id: "user-1" });
      expect(result.labels).toHaveLength(2);
      expect(result.team).toEqual({ key: "REPO" });
      expect(result.project).toEqual({ id: "123", name: "myproject" });
    });

    it("handles missing optional fields", () => {
      const parsed: ParsedIssue = {
        id: "123",
        identifier: "#45",
        title: "Test Issue",
        raw: {},
      };

      const result = toLinearIssue(parsed);

      expect(result.id).toBe("123");
      expect(result.description).toBeUndefined();
      expect(result.priority).toBeUndefined();
      expect(result.state).toBeUndefined();
      expect(result.assignee).toBeUndefined();
      expect(result.labels).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.project).toBeUndefined();
    });
  });

  describe("toLinearComment", () => {
    it("converts ParsedComment to LinearComment", () => {
      const parsed: ParsedComment = {
        id: "456",
        body: "This is a comment",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "#45",
          title: "Test Issue",
          teamKey: "REPO",
          raw: {},
        },
        author: { id: "user-1", name: "Test User" },
        createdAt: "2024-01-01T00:00:00Z",
        raw: { original: "data" },
      };

      const result = toLinearComment(parsed);

      expect(result.id).toBe("456");
      expect(result.body).toBe("This is a comment");
      expect(result.issueId).toBe("123");
      expect(result.issue.id).toBe("123");
      expect(result.issue.identifier).toBe("#45");
      expect(result.user).toEqual({ id: "user-1", name: "Test User" });
      expect(result.createdAt).toBe("2024-01-01T00:00:00Z");
    });

    it("handles missing author", () => {
      const parsed: ParsedComment = {
        id: "456",
        body: "This is a comment",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "#45",
          title: "Test Issue",
          raw: {},
        },
        createdAt: "2024-01-01T00:00:00Z",
        raw: {},
      };

      const result = toLinearComment(parsed);

      expect(result.user).toBeUndefined();
    });
  });
});

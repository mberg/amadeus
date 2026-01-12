// ABOUTME: Tests for comment filtering logic.
// ABOUTME: Verifies that bot comments are correctly identified and skipped.

import { describe, expect, it } from "bun:test";
import { isBotComment } from "../src/comment-filter";
import type { LinearComment } from "../src/types";

function createComment(
  body: string = "Test comment",
  userId?: string,
  userName?: string
): LinearComment {
  return {
    id: "comment-1",
    body,
    issueId: "issue-1",
    issue: {
      id: "issue-1",
      identifier: "TEST-1",
      title: "Test issue",
    },
    user: userId ? { id: userId, name: userName ?? "User" } : undefined,
    createdAt: new Date().toISOString(),
  };
}

describe("isBotComment", () => {
  describe("content-based detection", () => {
    it("returns true when comment starts with bot prefix", () => {
      const comment = createComment(
        "**🤖 Claude:** Here is my plan...",
        "human-user-456",
        "Matt Berg"
      );
      expect(isBotComment(comment, undefined)).toBe(true);
    });

    it("returns true for acknowledgment message", () => {
      const comment = createComment(
        "**🤖 Claude:** I've received the issue. Beginning the planning process.",
        "human-user-456",
        "Matt Berg"
      );
      expect(isBotComment(comment, undefined)).toBe(true);
    });

    it("returns false when comment does not have bot prefix", () => {
      const comment = createComment(
        "sounds good, proceed!",
        "human-user-456",
        "Matt Berg"
      );
      expect(isBotComment(comment, undefined)).toBe(false);
    });

    it("returns false when bot prefix is not at start", () => {
      const comment = createComment(
        "I think **🤖 Claude:** should do this",
        "human-user-456",
        "Matt Berg"
      );
      expect(isBotComment(comment, undefined)).toBe(false);
    });
  });

  describe("user ID detection (fallback)", () => {
    it("returns true when comment user ID matches bot user ID", () => {
      const comment = createComment("Regular text", "bot-user-123", "Claude Bot");
      expect(isBotComment(comment, "bot-user-123")).toBe(true);
    });

    it("returns false when comment user ID does not match bot user ID", () => {
      const comment = createComment("Regular text", "human-user-456", "Matt Berg");
      expect(isBotComment(comment, "bot-user-123")).toBe(false);
    });

    it("returns false when bot user ID is undefined and no bot prefix", () => {
      const comment = createComment("Regular text", "bot-user-123", "Claude Bot");
      expect(isBotComment(comment, undefined)).toBe(false);
    });

    it("returns false when comment has no user and no bot prefix", () => {
      const comment = createComment("Regular text");
      expect(isBotComment(comment, "bot-user-123")).toBe(false);
    });
  });
});

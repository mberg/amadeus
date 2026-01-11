// ABOUTME: Tests for comment filtering logic.
// ABOUTME: Verifies that bot comments are correctly identified and skipped.

import { describe, expect, it } from "bun:test";
import { isBotComment } from "../src/comment-filter";
import type { LinearComment } from "../src/types";

function createComment(userId?: string, userName?: string): LinearComment {
  return {
    id: "comment-1",
    body: "Test comment",
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
  it("returns true when comment user ID matches bot user ID", () => {
    const comment = createComment("bot-user-123", "Claude Bot");
    expect(isBotComment(comment, "bot-user-123")).toBe(true);
  });

  it("returns false when comment user ID does not match bot user ID", () => {
    const comment = createComment("human-user-456", "Matt Berg");
    expect(isBotComment(comment, "bot-user-123")).toBe(false);
  });

  it("returns false when bot user ID is undefined", () => {
    const comment = createComment("bot-user-123", "Claude Bot");
    expect(isBotComment(comment, undefined)).toBe(false);
  });

  it("returns false when comment has no user", () => {
    const comment = createComment();
    expect(isBotComment(comment, "bot-user-123")).toBe(false);
  });

  it("returns false when comment user ID is undefined", () => {
    const comment: LinearComment = {
      id: "comment-1",
      body: "Test comment",
      issueId: "issue-1",
      issue: {
        id: "issue-1",
        identifier: "TEST-1",
        title: "Test issue",
      },
      user: { id: undefined as unknown as string, name: "Anonymous" },
      createdAt: new Date().toISOString(),
    };
    expect(isBotComment(comment, "bot-user-123")).toBe(false);
  });
});

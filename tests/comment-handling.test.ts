// ABOUTME: Tests for comment handling logic.
// ABOUTME: Verifies filtering of Claude's own comments and comment history building.

import { describe, expect, it } from "bun:test";
import { isClaudeBotComment } from "../src/comment-filter";
import type { LinearComment } from "../src/types";

function makeComment(userId: string | undefined, body: string): LinearComment {
  return {
    id: "comment-1",
    body,
    issueId: "issue-1",
    issue: {
      id: "issue-1",
      identifier: "TEST-1",
      title: "Test Issue",
    },
    user: userId ? { id: userId, name: "Test User" } : undefined,
    createdAt: new Date().toISOString(),
  };
}

describe("isClaudeBotComment", () => {
  it("returns true when comment is from Claude bot", () => {
    const comment = makeComment("claude-bot-id", "Hello");
    expect(isClaudeBotComment(comment, "claude-bot-id")).toBe(true);
  });

  it("returns false when comment is from a different user", () => {
    const comment = makeComment("human-user-id", "Hello");
    expect(isClaudeBotComment(comment, "claude-bot-id")).toBe(false);
  });

  it("returns false when claudeBotUserId is undefined", () => {
    const comment = makeComment("any-user-id", "Hello");
    expect(isClaudeBotComment(comment, undefined)).toBe(false);
  });

  it("returns false when comment has no user", () => {
    const comment = makeComment(undefined, "Hello");
    expect(isClaudeBotComment(comment, "claude-bot-id")).toBe(false);
  });
});

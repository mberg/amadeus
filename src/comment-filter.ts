// ABOUTME: Filters comments that should not be processed by agents.
// ABOUTME: Used to skip bot-generated comments to prevent self-responses.

import type { LinearComment } from "./types";

// Pattern that identifies Claude bot comments (prefix used when posting)
const BOT_COMMENT_PATTERN = /^\*\*🤖 Claude:\*\*/;

/**
 * Checks if a comment was posted by the Claude bot.
 * Uses content-based detection since the API key owner is the comment author.
 * Bot comments should be skipped to prevent the agent from responding to its own messages.
 */
export function isBotComment(
  comment: LinearComment,
  botUserId: string | undefined
): boolean {
  // Primary detection: check comment body for bot prefix
  if (BOT_COMMENT_PATTERN.test(comment.body)) {
    return true;
  }

  // Secondary detection: user ID match (if bot has dedicated user)
  if (botUserId && comment.user?.id === botUserId) {
    return true;
  }

  return false;
}

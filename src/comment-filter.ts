// ABOUTME: Filters comments that should not be processed by agents.
// ABOUTME: Used to skip bot-generated comments to prevent self-responses.

import type { LinearComment } from "./types";

/**
 * Checks if a comment was posted by the Claude bot.
 * Bot comments should be skipped to prevent the agent from responding to its own messages.
 */
export function isBotComment(
  comment: LinearComment,
  botUserId: string | undefined
): boolean {
  if (!botUserId) {
    return false;
  }
  return comment.user?.id === botUserId;
}

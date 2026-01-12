// ABOUTME: Filters comments that should not be processed by agents.
// ABOUTME: Used to skip bot-generated comments to prevent self-responses.

import type { LinearComment } from "./types";

/**
 * Creates a regex pattern to match bot comments with the given agent name.
 */
function getBotCommentPattern(agentName: string): RegExp {
  // Escape special regex characters in the agent name
  const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\*\\*🤖 ${escaped}:\\*\\*`);
}

/**
 * Checks if a comment was posted by the bot.
 * Uses content-based detection since the API key owner is the comment author.
 * Bot comments should be skipped to prevent the agent from responding to its own messages.
 */
export function isBotComment(
  comment: LinearComment,
  botUserId: string | undefined,
  agentName: string = "Amadeus"
): boolean {
  // Primary detection: check comment body for bot prefix
  const pattern = getBotCommentPattern(agentName);
  if (pattern.test(comment.body)) {
    return true;
  }

  // Secondary detection: user ID match (if bot has dedicated user)
  if (botUserId && comment.user?.id === botUserId) {
    return true;
  }

  return false;
}

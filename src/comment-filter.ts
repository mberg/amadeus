// ABOUTME: Filters comments that should not be processed.
// ABOUTME: Identifies Claude bot comments to prevent feedback loops.

import type { LinearComment } from "./types";

export function isClaudeBotComment(
  comment: LinearComment,
  claudeBotUserId: string | undefined
): boolean {
  if (!claudeBotUserId) return false;
  return comment.user?.id === claudeBotUserId;
}

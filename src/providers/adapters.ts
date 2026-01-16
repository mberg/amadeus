// ABOUTME: Adapters to convert between provider types and legacy orchestrator types.
// ABOUTME: Enables gradual migration to provider-based architecture.

import type { LinearIssue, LinearComment } from "../types";
import type { ParsedIssue, ParsedComment } from "./types";

/**
 * Convert a ParsedIssue to LinearIssue format for orchestrator compatibility.
 */
export function toLinearIssue(parsed: ParsedIssue): LinearIssue {
  return {
    id: parsed.id,
    identifier: parsed.identifier,
    title: parsed.title,
    description: parsed.description,
    priority: parsed.priority,
    state: parsed.state,
    assignee: parsed.assignee,
    labels: parsed.labels,
    team: parsed.teamKey ? { key: parsed.teamKey } : undefined,
    project: parsed.projectName ? { id: parsed.id, name: parsed.projectName } : undefined,
  };
}

/**
 * Convert a ParsedComment to LinearComment format for orchestrator compatibility.
 */
export function toLinearComment(parsed: ParsedComment): LinearComment {
  return {
    id: parsed.id,
    body: parsed.body,
    issueId: parsed.issueId,
    issue: toLinearIssue(parsed.issue),
    user: parsed.author ? { id: parsed.author.id, name: parsed.author.name } : undefined,
    createdAt: parsed.createdAt,
  };
}

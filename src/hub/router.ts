// ABOUTME: Webhook routing logic for hub mode.
// ABOUTME: Routes webhooks to machines via database lookups.

import type { LinearWebhookPayload, LinearIssue, LinearComment } from "../shared/types";
import { resolveRoute } from "../db/routing";

export interface RouteResult {
  machineId: string | null;
  machineUrl: string | null;
  machineName: string | null;
  localRepoPath: string | null;
  reason: string;
}

function isComment(data: LinearIssue | LinearComment): data is LinearComment {
  return "body" in data && "issueId" in data;
}

/**
 * Get team key from webhook payload.
 */
export function getTeamKeyFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.identifier?.split("-")[0] ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.identifier?.split("-")[0] ?? null;
  }

  return null;
}

/**
 * Get project name from webhook payload.
 */
export function getProjectNameFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.project?.name ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.project?.name ?? null;
  }

  return null;
}

/**
 * Get assignee Linear user ID from webhook payload.
 */
export function getAssigneeIdFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.assignee?.id ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.assignee?.id ?? null;
  }

  return null;
}

/**
 * Determine which machine should handle a webhook.
 */
export async function routeWebhook(orgId: string, payload: LinearWebhookPayload): Promise<RouteResult> {
  const teamKey = getTeamKeyFromPayload(payload);
  const projectName = getProjectNameFromPayload(payload);
  const assigneeLinearId = getAssigneeIdFromPayload(payload);

  const route = await resolveRoute(orgId, {
    linearProjectName: projectName ?? undefined,
    teamKey: teamKey ?? undefined,
    assigneeLinearId: assigneeLinearId ?? undefined,
  });

  if (route) {
    return {
      machineId: route.machineId,
      machineUrl: route.machineUrl,
      machineName: route.machineName,
      localRepoPath: route.localRepoPath,
      reason: route.reason,
    };
  }

  return { machineId: null, machineUrl: null, machineName: null, localRepoPath: null, reason: "No matching project in database" };
}

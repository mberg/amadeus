// ABOUTME: Webhook routing logic for hub mode.
// ABOUTME: Determines which machine should handle an incoming webhook.

import type { LinearWebhookPayload, LinearIssue, LinearComment } from "../shared/types";
import { REALM_CONFIG } from "../shared/config";

export interface RouteResult {
  machineUrl: string | null; // null means process locally
  machineName: string | null;
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
 * Determine which machine should handle a webhook.
 */
export function routeWebhook(payload: LinearWebhookPayload): RouteResult {
  const teamKey = getTeamKeyFromPayload(payload);
  const projectName = getProjectNameFromPayload(payload);

  if (!REALM_CONFIG) {
    return { machineUrl: null, machineName: null, reason: "No realm config" };
  }

  // Search for matching project with machine assignment
  for (const realm of REALM_CONFIG.realms) {
    for (const project of realm.projects) {
      // Match by Linear project name (case-insensitive)
      if (projectName && project.linearProject?.toLowerCase() === projectName.toLowerCase()) {
        if (project.machineUrl) {
          return {
            machineUrl: project.machineUrl,
            machineName: project.linearProject ?? teamKey ?? "unknown",
            reason: `Matched project "${projectName}"`,
          };
        }
      }
    }
  }

  // Fall back to team key lookup
  if (teamKey) {
    const entry = REALM_CONFIG.projectByTeamKey.get(teamKey);
    if (entry?.project.machineUrl) {
      return {
        machineUrl: entry.project.machineUrl,
        machineName: teamKey,
        reason: `Matched team "${teamKey}"`,
      };
    }
  }

  return { machineUrl: null, machineName: null, reason: "No machine routing configured" };
}

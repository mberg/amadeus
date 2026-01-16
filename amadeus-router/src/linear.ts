// ABOUTME: Linear webhook signature verification and payload parsing.
// ABOUTME: Validates HMAC-SHA256 signatures and extracts issue info from webhooks.

import type { IssueInfo } from "./routing";

export interface LinearLabel {
  id: string;
  name: string;
}

export interface LinearTeam {
  key: string;
}

export interface LinearIssueData {
  id: string;
  identifier: string;
  title: string;
  labels?: LinearLabel[];
  team?: LinearTeam;
}

export interface LinearCommentData {
  id: string;
  body: string;
  issue: LinearIssueData;
}

export interface LinearWebhookPayload {
  action: string;
  type: "Issue" | "Comment" | string;
  data: LinearIssueData | LinearCommentData;
  webhookTimestamp: number;
}

function isCommentData(
  data: LinearIssueData | LinearCommentData
): data is LinearCommentData {
  return "issue" in data && "body" in data;
}

export async function verifyLinearSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expectedSignature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (expectedSignature.length !== signature.length) return false;

  let result = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    result |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

export function extractIssueInfo(
  payload: LinearWebhookPayload
): IssueInfo | null {
  if (payload.type === "Issue") {
    const data = payload.data as LinearIssueData;
    const labels = (data.labels ?? []).map((l) => l.name);
    const teamKey = data.team?.key ?? data.identifier.split("-")[0];

    return {
      identifier: data.identifier,
      labels,
      teamKey,
    };
  }

  if (payload.type === "Comment" && isCommentData(payload.data)) {
    const issue = payload.data.issue;
    const labels = (issue.labels ?? []).map((l) => l.name);
    const teamKey = issue.team?.key ?? issue.identifier.split("-")[0];

    return {
      identifier: issue.identifier,
      labels,
      teamKey,
    };
  }

  return null;
}

export interface PostCommentOptions {
  issueIdentifier: string;
  body: string;
  apiKey: string;
}

export async function postLinearComment(
  options: PostCommentOptions
): Promise<{ success: boolean; error?: string }> {
  const { issueIdentifier, body, apiKey } = options;

  // First, get the issue ID from identifier
  const issueQuery = `
    query IssueByIdentifier($identifier: String!) {
      issue(id: $identifier) {
        id
      }
    }
  `;

  try {
    const issueResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: issueQuery,
        variables: { identifier: issueIdentifier },
      }),
    });

    const issueResult = (await issueResponse.json()) as {
      data?: { issue?: { id: string } };
      errors?: Array<{ message: string }>;
    };

    if (issueResult.errors || !issueResult.data?.issue?.id) {
      return {
        success: false,
        error: issueResult.errors?.[0]?.message ?? "Issue not found",
      };
    }

    const issueId = issueResult.data.issue.id;

    // Create the comment
    const commentMutation = `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `;

    const commentResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: commentMutation,
        variables: { issueId, body },
      }),
    });

    const commentResult = (await commentResponse.json()) as {
      data?: { commentCreate?: { success: boolean } };
      errors?: Array<{ message: string }>;
    };

    if (commentResult.errors) {
      return {
        success: false,
        error: commentResult.errors[0]?.message,
      };
    }

    return { success: commentResult.data?.commentCreate?.success ?? false };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

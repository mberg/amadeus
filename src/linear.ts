// ABOUTME: Linear API utilities for fetching issue data.
// ABOUTME: Provides functions to fetch comments and other issue details.

import type { LinearComment, LinearIssue } from "./types";

export interface FetchedComment {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

/**
 * Fetches all comments for an issue from the Linear API.
 * Returns comments sorted by creation date (oldest first).
 */
export async function fetchIssueComments(
  issueId: string,
  apiKey: string
): Promise<FetchedComment[]> {
  const query = `
    query IssueComments($issueId: String!) {
      issue(id: $issueId) {
        comments {
          nodes {
            id
            body
            createdAt
            user {
              name
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query,
        variables: { issueId },
      }),
    });

    if (!response.ok) {
      console.warn(`[Linear] Failed to fetch comments: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const comments = data?.data?.issue?.comments?.nodes ?? [];

    // Sort by createdAt (oldest first) and map to our format
    return comments
      .sort((a: { createdAt: string }, b: { createdAt: string }) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      .map((c: { id: string; body: string; createdAt: string; user?: { name: string } }) => ({
        id: c.id,
        body: c.body,
        authorName: c.user?.name ?? "Unknown",
        createdAt: c.createdAt,
      }));
  } catch (err) {
    console.warn("[Linear] Error fetching comments:", err);
    return [];
  }
}

/**
 * Fetches full issue details from the Linear API.
 * Use this when webhook data is incomplete (e.g., comment webhooks don't include labels/state).
 */
export async function fetchIssueDetails(
  issueId: string,
  apiKey: string
): Promise<LinearIssue | null> {
  const query = `
    query IssueDetails($issueId: String!) {
      issue(id: $issueId) {
        id
        identifier
        title
        description
        priority
        state {
          id
          name
          type
        }
        assignee {
          id
        }
        labels {
          nodes {
            name
          }
        }
        team {
          key
        }
        project {
          id
          name
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query,
        variables: { issueId },
      }),
    });

    if (!response.ok) {
      console.warn(`[Linear] Failed to fetch issue details: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const issue = data?.data?.issue;

    if (!issue) {
      return null;
    }

    // Transform labels from {nodes: [{name}]} to [{name}]
    return {
      ...issue,
      labels: issue.labels?.nodes ?? [],
    };
  } catch (err) {
    console.warn("[Linear] Error fetching issue details:", err);
    return null;
  }
}

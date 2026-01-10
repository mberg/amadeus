// ABOUTME: Linear GraphQL API client for fetching issue comments.
// ABOUTME: Provides comment history when spawning agents from comment webhooks.

export interface CommentData {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

interface LinearApiResponse {
  data?: {
    issue?: {
      comments?: {
        nodes?: CommentData[];
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
}

export function parseCommentsResponse(response: unknown): CommentData[] {
  const typed = response as LinearApiResponse;
  return typed?.data?.issue?.comments?.nodes ?? [];
}

const COMMENTS_QUERY = `
  query IssueComments($issueId: String!) {
    issue(id: $issueId) {
      comments(first: 100) {
        nodes {
          id
          body
          createdAt
          user {
            id
            name
          }
        }
      }
    }
  }
`;

export async function fetchIssueComments(
  issueId: string,
  apiKey: string | undefined
): Promise<CommentData[]> {
  if (!apiKey) {
    console.warn("[LinearAPI] No API key configured, cannot fetch comments");
    return [];
  }

  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: COMMENTS_QUERY,
        variables: { issueId },
      }),
    });

    if (!response.ok) {
      console.error(`[LinearAPI] HTTP error: ${response.status}`);
      return [];
    }

    const data = await response.json();

    if (data.errors?.length) {
      console.error("[LinearAPI] GraphQL errors:", data.errors);
      return [];
    }

    return parseCommentsResponse(data);
  } catch (err) {
    console.error("[LinearAPI] Failed to fetch comments:", err);
    return [];
  }
}

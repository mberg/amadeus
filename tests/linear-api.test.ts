// ABOUTME: Tests for Linear API module.
// ABOUTME: Verifies comment parsing and API response handling.

import { describe, expect, it } from "bun:test";
import { parseCommentsResponse, CommentData } from "../src/linear-api";

describe("parseCommentsResponse", () => {
  it("parses valid response with comments", () => {
    const response = {
      data: {
        issue: {
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "First comment",
                createdAt: "2024-01-10T10:00:00Z",
                user: { id: "user-1", name: "Alice" },
              },
              {
                id: "comment-2",
                body: "Second comment",
                createdAt: "2024-01-10T11:00:00Z",
                user: { id: "user-2", name: "Bob" },
              },
            ],
          },
        },
      },
    };

    const comments = parseCommentsResponse(response);

    expect(comments).toHaveLength(2);
    expect(comments[0]).toEqual({
      id: "comment-1",
      body: "First comment",
      createdAt: "2024-01-10T10:00:00Z",
      user: { id: "user-1", name: "Alice" },
    });
    expect(comments[1]).toEqual({
      id: "comment-2",
      body: "Second comment",
      createdAt: "2024-01-10T11:00:00Z",
      user: { id: "user-2", name: "Bob" },
    });
  });

  it("returns empty array for issue with no comments", () => {
    const response = {
      data: {
        issue: {
          comments: {
            nodes: [],
          },
        },
      },
    };

    const comments = parseCommentsResponse(response);
    expect(comments).toEqual([]);
  });

  it("returns empty array for null issue", () => {
    const response = {
      data: {
        issue: null,
      },
    };

    const comments = parseCommentsResponse(response);
    expect(comments).toEqual([]);
  });

  it("returns empty array for missing data", () => {
    const response = {};

    const comments = parseCommentsResponse(response);
    expect(comments).toEqual([]);
  });

  it("handles comments without user", () => {
    const response = {
      data: {
        issue: {
          comments: {
            nodes: [
              {
                id: "comment-1",
                body: "Anonymous comment",
                createdAt: "2024-01-10T10:00:00Z",
                user: null,
              },
            ],
          },
        },
      },
    };

    const comments = parseCommentsResponse(response);

    expect(comments).toHaveLength(1);
    expect(comments[0].user).toBeNull();
  });
});

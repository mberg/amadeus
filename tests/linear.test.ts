// ABOUTME: Tests for Linear API utilities.
// ABOUTME: Tests comment fetching functionality.

import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { fetchIssueComments } from "../src/linear";

describe("fetchIssueComments", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns comments sorted oldest first", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              issue: {
                comments: {
                  nodes: [
                    {
                      id: "2",
                      body: "Second comment",
                      createdAt: "2024-01-02T00:00:00Z",
                      user: { name: "User B" },
                    },
                    {
                      id: "1",
                      body: "First comment",
                      createdAt: "2024-01-01T00:00:00Z",
                      user: { name: "User A" },
                    },
                  ],
                },
              },
            },
          }),
      } as Response)
    );

    const comments = await fetchIssueComments("issue-123", "api-key");

    expect(comments).toHaveLength(2);
    expect(comments[0].id).toBe("1");
    expect(comments[0].body).toBe("First comment");
    expect(comments[0].authorName).toBe("User A");
    expect(comments[1].id).toBe("2");
  });

  it("returns empty array on API error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
      } as Response)
    );

    const comments = await fetchIssueComments("issue-123", "bad-key");

    expect(comments).toEqual([]);
  });

  it("returns empty array when no comments exist", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              issue: {
                comments: {
                  nodes: [],
                },
              },
            },
          }),
      } as Response)
    );

    const comments = await fetchIssueComments("issue-123", "api-key");

    expect(comments).toEqual([]);
  });

  it("handles missing user name", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              issue: {
                comments: {
                  nodes: [
                    {
                      id: "1",
                      body: "Comment without user",
                      createdAt: "2024-01-01T00:00:00Z",
                      user: null,
                    },
                  ],
                },
              },
            },
          }),
      } as Response)
    );

    const comments = await fetchIssueComments("issue-123", "api-key");

    expect(comments).toHaveLength(1);
    expect(comments[0].authorName).toBe("Unknown");
  });
});

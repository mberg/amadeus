// ABOUTME: Unit tests for hub webhook routing logic.
// ABOUTME: Verifies team key and project name extraction from payloads.

import { describe, test, expect } from "bun:test";
import { getTeamKeyFromPayload, getProjectNameFromPayload } from "./router";
import type { LinearWebhookPayload } from "../shared/types";

describe("getTeamKeyFromPayload", () => {
  test("extracts team key from issue identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "ENG-456",
        title: "Test issue",
      },
    };
    expect(getTeamKeyFromPayload(payload)).toBe("ENG");
  });

  test("extracts team key from comment issue", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      data: {
        id: "c1",
        body: "Test comment",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "DATA-789",
          title: "Test issue",
        },
        createdAt: new Date().toISOString(),
      },
    };
    expect(getTeamKeyFromPayload(payload)).toBe("DATA");
  });

  test("returns empty string for empty identifier", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "",
        title: "Test issue",
      },
    };
    expect(getTeamKeyFromPayload(payload)).toBe("");
  });

  test("returns null for unknown payload type", () => {
    const payload = {
      action: "update",
      type: "Unknown",
      data: {
        id: "123",
      },
    } as unknown as LinearWebhookPayload;
    expect(getTeamKeyFromPayload(payload)).toBeNull();
  });
});

describe("getProjectNameFromPayload", () => {
  test("extracts project name from issue", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "ENG-456",
        title: "Test issue",
        project: { id: "p1", name: "MyProject" },
      },
    };
    expect(getProjectNameFromPayload(payload)).toBe("MyProject");
  });

  test("returns null when no project", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "ENG-456",
        title: "Test issue",
      },
    };
    expect(getProjectNameFromPayload(payload)).toBeNull();
  });

  test("extracts project name from comment issue", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      data: {
        id: "c1",
        body: "Test comment",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "DATA-789",
          title: "Test issue",
          project: { id: "p2", name: "CommentProject" },
        },
        createdAt: new Date().toISOString(),
      },
    };
    expect(getProjectNameFromPayload(payload)).toBe("CommentProject");
  });

  test("returns null for comment without project", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      data: {
        id: "c1",
        body: "Test comment",
        issueId: "123",
        issue: {
          id: "123",
          identifier: "DATA-789",
          title: "Test issue",
        },
        createdAt: new Date().toISOString(),
      },
    };
    expect(getProjectNameFromPayload(payload)).toBeNull();
  });
});

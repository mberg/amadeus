// ABOUTME: Tests for Linear webhook signature verification and comment posting.
// ABOUTME: Tests HMAC-SHA256 signature validation and Linear API integration.

import { describe, test, expect } from "bun:test";
import {
  verifyLinearSignature,
  extractIssueInfo,
  type LinearWebhookPayload,
} from "../src/linear";

describe("verifyLinearSignature", () => {
  const testSecret = "test-webhook-secret";

  async function signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  test("returns true for valid signature", async () => {
    const payload = '{"action":"create","type":"Issue"}';
    const signature = await signPayload(payload, testSecret);

    const result = await verifyLinearSignature(payload, signature, testSecret);

    expect(result).toBe(true);
  });

  test("returns false for invalid signature", async () => {
    const payload = '{"action":"create","type":"Issue"}';
    const wrongSignature = "deadbeef".repeat(8); // 64 hex chars

    const result = await verifyLinearSignature(
      payload,
      wrongSignature,
      testSecret
    );

    expect(result).toBe(false);
  });

  test("returns false for null signature", async () => {
    const payload = '{"action":"create","type":"Issue"}';

    const result = await verifyLinearSignature(payload, null, testSecret);

    expect(result).toBe(false);
  });

  test("returns false for empty secret", async () => {
    const payload = '{"action":"create","type":"Issue"}';
    const signature = await signPayload(payload, testSecret);

    const result = await verifyLinearSignature(payload, signature, "");

    expect(result).toBe(false);
  });

  test("returns false for tampered payload", async () => {
    const originalPayload = '{"action":"create","type":"Issue"}';
    const signature = await signPayload(originalPayload, testSecret);
    const tamperedPayload = '{"action":"update","type":"Issue"}';

    const result = await verifyLinearSignature(
      tamperedPayload,
      signature,
      testSecret
    );

    expect(result).toBe(false);
  });

  test("returns false for wrong length signature", async () => {
    const payload = '{"action":"create","type":"Issue"}';
    const shortSignature = "deadbeef";

    const result = await verifyLinearSignature(
      payload,
      shortSignature,
      testSecret
    );

    expect(result).toBe(false);
  });
});

describe("extractIssueInfo", () => {
  test("extracts info from Issue webhook", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "issue-123",
        identifier: "ONA-456",
        title: "Test issue",
        labels: [
          { id: "1", name: "ml" },
          { id: "2", name: "machine:gpu-beast" },
        ],
        team: { key: "ONA" },
      },
      webhookTimestamp: Date.now(),
    };

    const result = extractIssueInfo(payload);

    expect(result).not.toBeNull();
    expect(result?.identifier).toBe("ONA-456");
    expect(result?.labels).toContain("ml");
    expect(result?.labels).toContain("machine:gpu-beast");
    expect(result?.teamKey).toBe("ONA");
  });

  test("extracts info from Comment webhook", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      data: {
        id: "comment-123",
        body: "Test comment",
        issue: {
          id: "issue-456",
          identifier: "ML-789",
          title: "Test issue",
          labels: [{ id: "1", name: "backend" }],
          team: { key: "ML" },
        },
      },
      webhookTimestamp: Date.now(),
    };

    const result = extractIssueInfo(payload);

    expect(result).not.toBeNull();
    expect(result?.identifier).toBe("ML-789");
    expect(result?.labels).toContain("backend");
    expect(result?.teamKey).toBe("ML");
  });

  test("handles issue with no labels", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "issue-123",
        identifier: "ONA-456",
        title: "Test issue",
        labels: [],
        team: { key: "ONA" },
      },
      webhookTimestamp: Date.now(),
    };

    const result = extractIssueInfo(payload);

    expect(result).not.toBeNull();
    expect(result?.labels).toEqual([]);
  });

  test("handles missing labels array", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "issue-123",
        identifier: "ONA-456",
        title: "Test issue",
        team: { key: "ONA" },
      },
      webhookTimestamp: Date.now(),
    };

    const result = extractIssueInfo(payload);

    expect(result).not.toBeNull();
    expect(result?.labels).toEqual([]);
  });

  test("returns null for unknown webhook type", () => {
    const payload = {
      action: "create",
      type: "Project",
      data: {},
      webhookTimestamp: Date.now(),
    } as LinearWebhookPayload;

    const result = extractIssueInfo(payload);

    expect(result).toBeNull();
  });

  test("derives teamKey from identifier when team is missing", () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "issue-123",
        identifier: "DESIGN-999",
        title: "Test issue",
        labels: [],
      },
      webhookTimestamp: Date.now(),
    };

    const result = extractIssueInfo(payload);

    expect(result?.teamKey).toBe("DESIGN");
  });
});

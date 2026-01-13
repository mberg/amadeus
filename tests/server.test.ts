// ABOUTME: Integration tests for the HTTP server endpoints.
// ABOUTME: Tests health, webhook, status, and authentication.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void };
let baseUrl: string;
const TEST_TOKEN = "test-api-token-12345";

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

describe("HTTP Server", () => {
  beforeAll(async () => {
    // Set required env vars for test
    // Note: PORT is set in orchestrator.test.ts which loads config first
    process.env.LINEAR_WEBHOOK_SECRET = "test-secret";
    process.env.AMADEUS_API_TOKEN = TEST_TOKEN;
    process.env.LINEAR_WORKSPACE = "test-workspace";
    // For YAML config support
    process.env.LINEAR_API_KEY_ONA = "test-api-key";
    process.env.LINEAR_WEBHOOK_SECRET_ONA = "test-secret";

    // Import and start server (uses port from config, set by orchestrator.test.ts)
    const mod = await import("../src/server");
    server = mod.server;
    baseUrl = `http://localhost:${mod.server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  describe("GET /health", () => {
    it("returns OK", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");
    });
  });

  describe("GET /status", () => {
    it("returns agent status as JSON with valid token", async () => {
      const res = await fetch(`${baseUrl}/status`, {
        headers: { "X-Amadeus-Token": TEST_TOKEN },
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("agents");
      expect(data).toHaveProperty("timestamp");
      expect(Array.isArray(data.agents)).toBe(true);
    });

    it("returns 401 without token", async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /dashboard", () => {
    it("returns HTML dashboard", async () => {
      const res = await fetch(`${baseUrl}/dashboard`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("text/html");

      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Amadeus");
    });
  });

  describe("POST /webhook", () => {
    it("rejects invalid signature", async () => {
      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": "invalid",
        },
        body: JSON.stringify({ action: "update", type: "Issue", data: {} }),
      });

      expect(res.status).toBe(401);
    });

    it("accepts valid signature with valid timestamp", async () => {
      const payload = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          id: "test-id",
          identifier: "TEST-1",
          title: "Test issue",
          state: { id: "s1", name: "Backlog" },
        },
        webhookTimestamp: Date.now(),
      });

      const signature = await signPayload(payload, "test-secret");

      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": signature,
        },
        body: payload,
      });

      expect(res.status).toBe(200);
    });

    it("rejects webhook with missing timestamp", async () => {
      const payload = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          id: "test-id",
          identifier: "TEST-1",
          title: "Test issue",
          state: { id: "s1", name: "Backlog" },
        },
      });

      const signature = await signPayload(payload, "test-secret");

      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": signature,
        },
        body: payload,
      });

      expect(res.status).toBe(401);
    });

    it("rejects webhook with stale timestamp", async () => {
      const staleTimestamp = Date.now() - 120000; // 2 minutes ago
      const payload = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          id: "test-id",
          identifier: "TEST-1",
          title: "Test issue",
          state: { id: "s1", name: "Backlog" },
        },
        webhookTimestamp: staleTimestamp,
      });

      const signature = await signPayload(payload, "test-secret");

      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": signature,
        },
        body: payload,
      });

      expect(res.status).toBe(401);
    });

    it("rejects webhook with future timestamp", async () => {
      const futureTimestamp = Date.now() + 120000; // 2 minutes in future
      const payload = JSON.stringify({
        action: "update",
        type: "Issue",
        data: {
          id: "test-id",
          identifier: "TEST-1",
          title: "Test issue",
          state: { id: "s1", name: "Backlog" },
        },
        webhookTimestamp: futureTimestamp,
      });

      const signature = await signPayload(payload, "test-secret");

      const res = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": signature,
        },
        body: payload,
      });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /trigger", () => {
    it("returns Sent for valid request with token", async () => {
      const res = await fetch(`${baseUrl}/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Amadeus-Token": TEST_TOKEN,
        },
        body: JSON.stringify({ agentKey: "test-key", message: "hello" }),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Sent");
    });

    it("returns 401 without token", async () => {
      const res = await fetch(`${baseUrl}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentKey: "test-key", message: "hello" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /unknown", () => {
    it("returns 404", async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /agents/:key/messages", () => {
    it("returns 404 for non-existent agent with valid token", async () => {
      const res = await fetch(`${baseUrl}/agents/nonexistent-key/messages`, {
        headers: { "X-Amadeus-Token": TEST_TOKEN },
      });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Agent not found");
    });

    it("returns 401 without token", async () => {
      const res = await fetch(`${baseUrl}/agents/nonexistent-key/messages`);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /config", () => {
    it("returns config with valid token", async () => {
      const res = await fetch(`${baseUrl}/config`, {
        headers: { "X-Amadeus-Token": TEST_TOKEN },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("linearWorkspace");
    });

    it("returns 401 without token", async () => {
      const res = await fetch(`${baseUrl}/config`);
      expect(res.status).toBe(401);
    });
  });
});

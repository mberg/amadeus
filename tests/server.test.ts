// ABOUTME: Integration tests for the HTTP server endpoints.
// ABOUTME: Tests health, webhook, and status endpoints.

import { describe, expect, it, beforeAll, afterAll } from "bun:test";

let server: { stop: () => void };
let baseUrl: string;

describe("HTTP Server", () => {
  beforeAll(async () => {
    // Set required env vars for test
    process.env.LINEAR_WEBHOOK_SECRET = "test-secret";

    // Import and start server
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
    it("returns agent status as JSON", async () => {
      const res = await fetch(`${baseUrl}/status`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("agents");
      expect(data).toHaveProperty("timestamp");
      expect(Array.isArray(data.agents)).toBe(true);
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

    it("accepts valid signature", async () => {
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

      // Compute valid signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode("test-secret"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const signature = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

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
  });

  describe("GET /unknown", () => {
    it("returns 404", async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });
  });
});

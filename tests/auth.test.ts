// ABOUTME: Tests for authentication middleware in simple auth mode.
// ABOUTME: Verifies secure defaults when API token is not configured.

import { describe, expect, it } from "bun:test";
import { getAuthContext } from "../src/auth";

function mockRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/test", { headers });
}

describe("getAuthContext in simple mode", () => {
  describe("when no API token is configured", () => {
    it("denies access by default", async () => {
      const req = mockRequest();
      const context = await getAuthContext(req, undefined);

      expect(context.authenticated).toBe(false);
      expect(context.mode).toBe("simple");
    });

    it("denies access even with X-Amadeus-Token header", async () => {
      const req = mockRequest({ "X-Amadeus-Token": "some-token" });
      const context = await getAuthContext(req, undefined);

      expect(context.authenticated).toBe(false);
    });
  });

  describe("when API token is configured", () => {
    const apiToken = "test-secret-token";

    it("grants admin access with valid token", async () => {
      const req = mockRequest({ "X-Amadeus-Token": apiToken });
      const context = await getAuthContext(req, apiToken);

      expect(context.authenticated).toBe(true);
      expect(context.role).toBe("admin");
      expect(context.mode).toBe("simple");
    });

    it("denies access with invalid token", async () => {
      const req = mockRequest({ "X-Amadeus-Token": "wrong-token" });
      const context = await getAuthContext(req, apiToken);

      expect(context.authenticated).toBe(false);
    });

    it("denies access with no token header", async () => {
      const req = mockRequest();
      const context = await getAuthContext(req, apiToken);

      expect(context.authenticated).toBe(false);
    });
  });
});

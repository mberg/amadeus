// ABOUTME: Tests for the extracted fetch handler factory.
// ABOUTME: Verifies createFetchHandler returns a working handler with correct routing.

import { describe, test, expect } from "bun:test";
import { createFetchHandler, type ServerContext } from "./create-server";

function makeContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    orchestrator: null,
    machineRegistry: null,
    healthMonitor: null,
    persistence: null,
    hubHeartbeat: null,
    routerHeartbeat: null,
    idleScanner: null,
    ...overrides,
  };
}

describe("createFetchHandler", () => {
  test("returns a function", () => {
    const handler = createFetchHandler(makeContext());
    expect(typeof handler).toBe("function");
  });

  test("handler responds to /health with 200", async () => {
    const handler = createFetchHandler(makeContext());
    const res = await handler(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("handler redirects / to /dashboard", async () => {
    const handler = createFetchHandler(makeContext());
    const res = await handler(new Request("http://localhost/"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  test("handler returns 404 for unknown routes", async () => {
    const handler = createFetchHandler(makeContext());
    const res = await handler(new Request("http://localhost/nonexistent"));
    expect(res.status).toBe(404);
  });

  test("handler returns auth info at /auth/info", async () => {
    const handler = createFetchHandler(makeContext());
    const res = await handler(new Request("http://localhost/auth/info"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("mode");
    expect(data).toHaveProperty("clerkEnabled");
  });
});

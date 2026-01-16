// ABOUTME: Tests for the router heartbeat sender.
// ABOUTME: Tests heartbeat sending, error handling, and lifecycle management.

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { RouterHeartbeat } from "../src/router-heartbeat";

describe("RouterHeartbeat", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = mock(() =>
      Promise.resolve(new Response("OK", { status: 200 }))
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("sendHeartbeat", () => {
    test("sends heartbeat to router URL", async () => {
      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
      });

      await heartbeat.sendHeartbeat();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://router.workers.dev/heartbeat");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.machine).toBe("macbook");
      expect(body.secret).toBe("test-secret");
    });

    test("handles fetch errors gracefully", async () => {
      mockFetch = mock(() => Promise.reject(new Error("Network error")));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
      });

      // Should not throw
      await heartbeat.sendHeartbeat();
    });

    test("handles non-ok response gracefully", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response("Unauthorized", { status: 401 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
      });

      // Should not throw
      await heartbeat.sendHeartbeat();
    });
  });

  describe("start/stop", () => {
    test("starts interval timer", async () => {
      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
        intervalMs: 100,
      });

      heartbeat.start();

      // Should send initial heartbeat
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);

      heartbeat.stop();
    });

    test("stops interval timer", async () => {
      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
        intervalMs: 100,
      });

      heartbeat.start();
      await new Promise((r) => setTimeout(r, 50));
      const callsBeforeStop = mockFetch.mock.calls.length;

      heartbeat.stop();
      await new Promise((r) => setTimeout(r, 150));

      // No additional calls after stop
      expect(mockFetch.mock.calls.length).toBe(callsBeforeStop);
    });

    test("handles multiple start calls gracefully", () => {
      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
        intervalMs: 1000,
      });

      // Should not throw
      heartbeat.start();
      heartbeat.start();
      heartbeat.stop();
    });

    test("handles stop without start", () => {
      const heartbeat = new RouterHeartbeat({
        routerUrl: "https://router.workers.dev",
        machineName: "macbook",
        secret: "test-secret",
      });

      // Should not throw
      heartbeat.stop();
    });
  });

  describe("isConfigured", () => {
    test("returns false for empty config", () => {
      expect(RouterHeartbeat.isConfigured({})).toBe(false);
    });

    test("returns false for partial config", () => {
      expect(
        RouterHeartbeat.isConfigured({
          routerUrl: "https://router.workers.dev",
        })
      ).toBe(false);
    });

    test("returns true for complete config", () => {
      expect(
        RouterHeartbeat.isConfigured({
          routerUrl: "https://router.workers.dev",
          machineName: "macbook",
          routerSecret: "secret",
        })
      ).toBe(true);
    });
  });
});

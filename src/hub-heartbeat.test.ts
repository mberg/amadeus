// ABOUTME: Tests for hub-heartbeat token hash authentication.
// ABOUTME: Verifies that machine tokens are sent as SHA-256 hashed headers.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { HubHeartbeat, type HubHeartbeatConfig } from "./hub-heartbeat";

describe("HubHeartbeat token hash", () => {
  let capturedHeaders: Record<string, string> = {};
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    capturedHeaders = {};
    originalFetch = globalThis.fetch;
    // @ts-expect-error -- mock fetch to capture headers
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers) {
        Object.assign(capturedHeaders, headers);
      }
      return new Response("OK", { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends X-Machine-Token-Hash header when token is provided", async () => {
    const config: HubHeartbeatConfig = {
      hubUrl: "http://hub.example.com",
      machineName: "test-machine",
      machineUrl: "http://machine.example.com",
      token: "my-secret-token",
    };

    const heartbeat = new HubHeartbeat(config, async () => []);
    await heartbeat.sendHeartbeat();

    const expectedHash = new Bun.CryptoHasher("sha256")
      .update("my-secret-token")
      .digest("hex");

    expect(capturedHeaders["X-Machine-Token-Hash"]).toBe(expectedHash);
  });

  test("does not send X-Machine-Token-Hash header when no token", async () => {
    const config: HubHeartbeatConfig = {
      hubUrl: "http://hub.example.com",
      machineName: "test-machine",
      machineUrl: "http://machine.example.com",
    };

    const heartbeat = new HubHeartbeat(config, async () => []);
    await heartbeat.sendHeartbeat();

    expect(capturedHeaders["X-Machine-Token-Hash"]).toBeUndefined();
  });

  test("sends both Authorization and X-Machine-Token-Hash when both are set", async () => {
    const config: HubHeartbeatConfig = {
      hubUrl: "http://hub.example.com",
      machineName: "test-machine",
      machineUrl: "http://machine.example.com",
      apiKey: "my-api-key",
      token: "my-secret-token",
    };

    const heartbeat = new HubHeartbeat(config, async () => []);
    await heartbeat.sendHeartbeat();

    expect(capturedHeaders["Authorization"]).toBe("Bearer my-api-key");
    expect(capturedHeaders["X-Machine-Token-Hash"]).toBeDefined();
  });
});

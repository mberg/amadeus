// ABOUTME: Tests for hub-heartbeat token hash authentication and completion reporting.
// ABOUTME: Verifies token hashing and that agent completions are forwarded to the hub.

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

describe("HubHeartbeat reportCompletion", () => {
  let capturedUrl: string = "";
  let capturedBody: any = null;
  let capturedHeaders: Record<string, string> = {};
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    capturedUrl = "";
    capturedBody = null;
    capturedHeaders = {};
    originalFetch = globalThis.fetch;
    // @ts-expect-error -- mock fetch to capture request
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response("OK", { status: 200 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("POSTs completion data to /hub/agent-complete", async () => {
    const config: HubHeartbeatConfig = {
      hubUrl: "http://hub.example.com",
      machineName: "test-machine",
      machineUrl: "http://machine.example.com",
      token: "my-secret-token",
    };

    const heartbeat = new HubHeartbeat(config, async () => []);
    await heartbeat.reportCompletion({
      key: "ENG-123",
      issueId: "issue-1",
      issueIdentifier: "ENG-123",
      issueTitle: "Fix the bug",
      completionReason: "done",
      duration: 5000,
    });

    expect(capturedUrl).toBe("http://hub.example.com/hub/agent-complete");
    expect(capturedBody.machineName).toBe("test-machine");
    expect(capturedBody.completion.key).toBe("ENG-123");
    expect(capturedBody.completion.issueTitle).toBe("Fix the bug");
    expect(capturedBody.completion.completionReason).toBe("done");
    expect(capturedBody.completion.duration).toBe(5000);
  });

  test("includes auth headers", async () => {
    const config: HubHeartbeatConfig = {
      hubUrl: "http://hub.example.com",
      machineName: "test-machine",
      machineUrl: "http://machine.example.com",
      token: "my-secret-token",
    };

    const heartbeat = new HubHeartbeat(config, async () => []);
    await heartbeat.reportCompletion({
      key: "ENG-123",
      issueId: "issue-1",
      issueIdentifier: "ENG-123",
      issueTitle: "Fix the bug",
      completionReason: "done",
      duration: 5000,
    });

    const expectedHash = new Bun.CryptoHasher("sha256")
      .update("my-secret-token")
      .digest("hex");
    expect(capturedHeaders["X-Machine-Token-Hash"]).toBe(expectedHash);
  });
});

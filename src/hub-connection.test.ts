// ABOUTME: Tests for machine-side WebSocket client.
// ABOUTME: Verifies authentication, heartbeat sending, stop command handling, and reconnection.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { HubConnection, type HubConnectionConfig } from "./hub-connection";

// Track WebSocket mock state
let mockWsInstances: MockWebSocket[] = [];
let originalWebSocket: typeof WebSocket;

class MockWebSocket {
  url: string;
  sent: string[] = [];
  readyState = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
    // Auto-connect after microtask
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code: code ?? 1000, reason }));
  }

  ping() {}

  // Helpers for testing
  simulateMessage(data: any) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  simulateClose(code = 1000, reason = "") {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }
}

describe("HubConnection", () => {
  beforeEach(() => {
    mockWsInstances = [];
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error -- mock WebSocket
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  test("connects to hub with correct WS URL", async () => {
    const conn = new HubConnection(
      { hubUrl: "https://hub.example.com", machineName: "test", token: "tok" },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0].url).toBe("wss://hub.example.com/ws");

    conn.stop();
  });

  test("converts http URL to ws URL", async () => {
    const conn = new HubConnection(
      { hubUrl: "http://localhost:5678", machineName: "test", token: "tok" },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    expect(mockWsInstances[0].url).toBe("ws://localhost:5678/ws");

    conn.stop();
  });

  test("sends auth message on connect", async () => {
    const conn = new HubConnection(
      { hubUrl: "http://hub:5678", machineName: "my-machine", token: "secret-token" },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    expect(ws.sent).toHaveLength(1);
    const authMsg = JSON.parse(ws.sent[0]);
    expect(authMsg.type).toBe("auth");
    expect(authMsg.machineName).toBe("my-machine");
    // Verify it's a sha256 hash, not the raw token
    expect(authMsg.tokenHash).not.toBe("secret-token");
    expect(authMsg.tokenHash).toHaveLength(64); // sha256 hex length

    conn.stop();
  });

  test("sends heartbeat after auth-ok", async () => {
    const agents = [{ key: "ENG-1", status: "working", port: 3000, issueId: "x", issueIdentifier: "ENG-1", issueTitle: "test", uptime: 100 }];
    const conn = new HubConnection(
      { hubUrl: "http://hub:5678", machineName: "test", token: "tok" },
      async () => agents as any
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    // Simulate auth-ok
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    // Should have sent auth + heartbeat
    expect(ws.sent.length).toBeGreaterThanOrEqual(2);
    const heartbeatMsg = JSON.parse(ws.sent[1]);
    expect(heartbeatMsg.type).toBe("heartbeat");
    expect(heartbeatMsg.agents).toHaveLength(1);

    conn.stop();
  });

  test("handles stop command from hub", async () => {
    const stopped: Array<{ agentKey: string; reason: string }> = [];

    const conn = new HubConnection(
      {
        hubUrl: "http://hub:5678",
        machineName: "test",
        token: "tok",
        onStopCommand: (agentKey, reason) => stopped.push({ agentKey, reason }),
      },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    ws.simulateMessage({ type: "stop", agentKey: "ENG-123", reason: "idle" });
    await Bun.sleep(10);

    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toEqual({ agentKey: "ENG-123", reason: "idle" });

    conn.stop();
  });

  test("handles webhook from hub", async () => {
    let receivedWebhook: any = null;

    const conn = new HubConnection(
      {
        hubUrl: "http://hub:5678",
        machineName: "test",
        token: "tok",
        onWebhook: (payload, signature, routing) => {
          receivedWebhook = { payload, signature, routing };
        },
      },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    ws.simulateMessage({
      type: "webhook",
      payload: '{"action":"create"}',
      signature: "sig-abc",
      routing: { localRepoPath: "/code/project" },
    });
    await Bun.sleep(10);

    expect(receivedWebhook).not.toBeNull();
    expect(receivedWebhook.payload).toBe('{"action":"create"}');
    expect(receivedWebhook.signature).toBe("sig-abc");
    expect(receivedWebhook.routing.localRepoPath).toBe("/code/project");

    conn.stop();
  });

  test("responds to get-messages request", async () => {
    const conn = new HubConnection(
      {
        hubUrl: "http://hub:5678",
        machineName: "test",
        token: "tok",
        onGetMessages: async (agentKey) => {
          return [{ role: "user", content: `Messages for ${agentKey}` }];
        },
      },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    ws.simulateMessage({
      type: "get-messages",
      id: "req-1",
      agentKey: "ENG-123",
    });
    await Bun.sleep(50);

    // Find the messages-response in sent messages
    const responseMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === "messages-response");
    expect(responseMsgs).toHaveLength(1);
    expect(responseMsgs[0].id).toBe("req-1");
    expect(responseMsgs[0].messages).toHaveLength(1);

    conn.stop();
  });

  test("responds to trigger request", async () => {
    const conn = new HubConnection(
      {
        hubUrl: "http://hub:5678",
        machineName: "test",
        token: "tok",
        onTrigger: async (agentKey, message) => true,
      },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    ws.simulateMessage({
      type: "trigger",
      id: "req-2",
      agentKey: "ENG-123",
      message: "do something",
    });
    await Bun.sleep(50);

    const responseMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === "trigger-response");
    expect(responseMsgs).toHaveLength(1);
    expect(responseMsgs[0].id).toBe("req-2");
    expect(responseMsgs[0].success).toBe(true);

    conn.stop();
  });

  test("stops reconnecting on auth failure", async () => {
    const conn = new HubConnection(
      { hubUrl: "http://hub:5678", machineName: "test", token: "bad-tok" },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-fail", reason: "Invalid token" });
    await Bun.sleep(50);

    // Should not create new connections
    expect(mockWsInstances).toHaveLength(1);

    conn.stop();
  });

  test("reports agent completion", async () => {
    const conn = new HubConnection(
      { hubUrl: "http://hub:5678", machineName: "test", token: "tok" },
      async () => []
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    conn.reportCompletion({
      key: "ENG-456",
      issueId: "issue-2",
      issueIdentifier: "ENG-456",
      issueTitle: "Add feature",
      completionReason: "done",
      duration: 10000,
    });

    const completionMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === "agent-complete");
    expect(completionMsgs).toHaveLength(1);
    expect(completionMsgs[0].completion.key).toBe("ENG-456");
    expect(completionMsgs[0].completion.completionReason).toBe("done");

    conn.stop();
  });

  test("notifyAgentChange sends immediate heartbeat", async () => {
    const conn = new HubConnection(
      { hubUrl: "http://hub:5678", machineName: "test", token: "tok" },
      async () => [{ key: "ENG-1", status: "working", port: 3000, issueId: "x", issueIdentifier: "ENG-1", issueTitle: "test", uptime: 100 }] as any
    );

    conn.start();
    await Bun.sleep(10);

    const ws = mockWsInstances[0];
    ws.simulateMessage({ type: "auth-ok" });
    await Bun.sleep(10);

    const sentBefore = ws.sent.length;
    conn.notifyAgentChange();
    await Bun.sleep(10);

    const newMsgs = ws.sent.slice(sentBefore).map(s => JSON.parse(s));
    const heartbeats = newMsgs.filter(m => m.type === "heartbeat");
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);

    conn.stop();
  });
});

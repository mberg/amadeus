// ABOUTME: Tests for WebSocket protocol message parsing and validation.
// ABOUTME: Verifies parseWsMessage handles valid, invalid, and edge-case inputs.

import { describe, test, expect } from "bun:test";
import { parseWsMessage, WS_REQUEST_TIMEOUT_MS, WS_PING_INTERVAL_MS } from "./ws-protocol";

describe("parseWsMessage", () => {
  test("parses valid auth message", () => {
    const msg = parseWsMessage(JSON.stringify({
      type: "auth",
      tokenHash: "abc123",
      machineName: "test-machine",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("auth");
  });

  test("parses valid heartbeat message", () => {
    const msg = parseWsMessage(JSON.stringify({
      type: "heartbeat",
      agents: [{ key: "ENG-123", status: "working", port: 3000, issueId: "x", issueIdentifier: "ENG-123", issueTitle: "test", uptime: 100 }],
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("heartbeat");
  });

  test("parses valid agent-complete message", () => {
    const msg = parseWsMessage(JSON.stringify({
      type: "agent-complete",
      completion: {
        key: "ENG-123",
        issueId: "issue-1",
        issueIdentifier: "ENG-123",
        issueTitle: "Fix bug",
        completionReason: "done",
        duration: 5000,
      },
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("agent-complete");
  });

  test("parses valid hub→machine messages", () => {
    expect(parseWsMessage(JSON.stringify({ type: "auth-ok" }))!.type).toBe("auth-ok");
    expect(parseWsMessage(JSON.stringify({ type: "auth-fail", reason: "bad token" }))!.type).toBe("auth-fail");
    expect(parseWsMessage(JSON.stringify({ type: "heartbeat-ack" }))!.type).toBe("heartbeat-ack");
    expect(parseWsMessage(JSON.stringify({
      type: "stop",
      agentKey: "ENG-123",
      reason: "idle",
    }))!.type).toBe("stop");
    expect(parseWsMessage(JSON.stringify({
      type: "webhook",
      payload: "{}",
      signature: null,
    }))!.type).toBe("webhook");
    expect(parseWsMessage(JSON.stringify({
      type: "get-messages",
      id: "uuid-1",
      agentKey: "ENG-123",
    }))!.type).toBe("get-messages");
    expect(parseWsMessage(JSON.stringify({
      type: "trigger",
      id: "uuid-2",
      agentKey: "ENG-123",
      message: "hello",
    }))!.type).toBe("trigger");
  });

  test("parses response messages", () => {
    expect(parseWsMessage(JSON.stringify({
      type: "messages-response",
      id: "uuid-1",
      messages: [],
    }))!.type).toBe("messages-response");
    expect(parseWsMessage(JSON.stringify({
      type: "trigger-response",
      id: "uuid-2",
      success: true,
    }))!.type).toBe("trigger-response");
  });

  test("returns null for invalid JSON", () => {
    expect(parseWsMessage("not json")).toBeNull();
  });

  test("returns null for non-object JSON", () => {
    expect(parseWsMessage(JSON.stringify("string"))).toBeNull();
    expect(parseWsMessage(JSON.stringify(42))).toBeNull();
    expect(parseWsMessage(JSON.stringify(null))).toBeNull();
  });

  test("returns null for missing type field", () => {
    expect(parseWsMessage(JSON.stringify({ data: "hello" }))).toBeNull();
  });

  test("returns null for unknown type", () => {
    expect(parseWsMessage(JSON.stringify({ type: "unknown-msg" }))).toBeNull();
  });

  test("accepts Buffer input", () => {
    const buf = Buffer.from(JSON.stringify({ type: "auth-ok" }));
    const msg = parseWsMessage(buf);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("auth-ok");
  });
});

describe("protocol constants", () => {
  test("request timeout is 10 seconds", () => {
    expect(WS_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  test("ping interval is 30 seconds", () => {
    expect(WS_PING_INTERVAL_MS).toBe(30_000);
  });
});

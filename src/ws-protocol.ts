// ABOUTME: WebSocket message type definitions shared by hub and machine.
// ABOUTME: Defines the protocol for bidirectional hub↔machine communication.

import type { AgentStatus } from "./types";

// --- Machine → Hub messages ---

export interface AuthMessage {
  type: "auth";
  tokenHash: string;
  machineName: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  agents: AgentStatus[];
}

export interface AgentCompleteMessage {
  type: "agent-complete";
  completion: {
    key: string;
    issueId: string;
    issueIdentifier: string;
    issueTitle: string;
    linearProject?: string;
    completionReason: string;
    finalLinearState?: string;
    duration: number;
  };
}

export interface MessagesResponseMessage {
  type: "messages-response";
  id: string;
  messages: unknown[];
}

export interface TriggerResponseMessage {
  type: "trigger-response";
  id: string;
  success: boolean;
}

export type MachineToHubMessage =
  | AuthMessage
  | HeartbeatMessage
  | AgentCompleteMessage
  | MessagesResponseMessage
  | TriggerResponseMessage;

// --- Hub → Machine messages ---

export interface AuthOkMessage {
  type: "auth-ok";
}

export interface AuthFailMessage {
  type: "auth-fail";
  reason: string;
}

export interface WebhookMessage {
  type: "webhook";
  payload: string;
  signature: string | null;
  routing?: {
    localRepoPath?: string;
    linearApiKey?: string;
    promptTemplate?: string;
  };
}

export interface StopMessage {
  type: "stop";
  agentKey: string;
  reason: string;
}

export interface HeartbeatAckMessage {
  type: "heartbeat-ack";
}

export interface GetMessagesMessage {
  type: "get-messages";
  id: string;
  agentKey: string;
}

export interface TriggerMessage {
  type: "trigger";
  id: string;
  agentKey: string;
  message: string;
}

export type HubToMachineMessage =
  | AuthOkMessage
  | AuthFailMessage
  | WebhookMessage
  | StopMessage
  | HeartbeatAckMessage
  | GetMessagesMessage
  | TriggerMessage;

// --- Shared utilities ---

export type WsMessage = MachineToHubMessage | HubToMachineMessage;

const VALID_MACHINE_TYPES = new Set([
  "auth",
  "heartbeat",
  "agent-complete",
  "messages-response",
  "trigger-response",
]);

const VALID_HUB_TYPES = new Set([
  "auth-ok",
  "auth-fail",
  "webhook",
  "stop",
  "heartbeat-ack",
  "get-messages",
  "trigger",
]);

/**
 * Parse a raw WebSocket message into a typed message.
 * Returns null if parsing fails.
 */
export function parseWsMessage(data: string | Buffer): WsMessage | null {
  try {
    const str = typeof data === "string" ? data : data.toString("utf-8");
    const msg = JSON.parse(str);
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
      return null;
    }
    if (!VALID_MACHINE_TYPES.has(msg.type) && !VALID_HUB_TYPES.has(msg.type)) {
      return null;
    }
    return msg as WsMessage;
  } catch {
    return null;
  }
}

/** Timeout for request/response correlation (ms). */
export const WS_REQUEST_TIMEOUT_MS = 10_000;

/** Interval for WebSocket-level ping (ms). */
export const WS_PING_INTERVAL_MS = 30_000;

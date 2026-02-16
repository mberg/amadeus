// ABOUTME: Hub-side WebSocket connection tracker for connected machines.
// ABOUTME: Routes messages to machines and handles request/response correlation.

import type { ServerWebSocket } from "bun";
import type {
  HubToMachineMessage,
  MachineToHubMessage,
  MessagesResponseMessage,
  TriggerResponseMessage,
} from "../ws-protocol";
import { WS_REQUEST_TIMEOUT_MS } from "../ws-protocol";

export interface WsConnectionData {
  machineName: string | null;
  machineId: string | null;
  orgId: string | null;
  authenticated: boolean;
}

type PendingResolver = {
  resolve: (msg: MessagesResponseMessage | TriggerResponseMessage) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class WsConnections {
  private connections = new Map<string, ServerWebSocket<WsConnectionData>>();
  private pendingRequests = new Map<string, PendingResolver>();

  /**
   * Register an authenticated machine connection.
   */
  register(machineName: string, ws: ServerWebSocket<WsConnectionData>): void {
    const existing = this.connections.get(machineName);
    if (existing && existing !== ws) {
      // Close stale connection
      try { existing.close(1000, "replaced"); } catch {}
    }
    this.connections.set(machineName, ws);
  }

  /**
   * Remove a machine connection (on disconnect).
   */
  remove(machineName: string, ws: ServerWebSocket<WsConnectionData>): void {
    const current = this.connections.get(machineName);
    if (current === ws) {
      this.connections.delete(machineName);
    }
  }

  /**
   * Check if a machine is connected via WebSocket.
   */
  isConnected(machineName: string): boolean {
    return this.connections.has(machineName);
  }

  /**
   * Get the connection for a machine by name.
   */
  get(machineName: string): ServerWebSocket<WsConnectionData> | undefined {
    return this.connections.get(machineName);
  }

  /**
   * Send a message to a connected machine.
   * Returns true if sent, false if machine not connected.
   */
  send(machineName: string, message: HubToMachineMessage): boolean {
    const ws = this.connections.get(machineName);
    if (!ws) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      this.connections.delete(machineName);
      return false;
    }
  }

  /**
   * Send a request to a machine and wait for a correlated response.
   * Uses the message `id` field for correlation.
   */
  sendRequest(
    machineName: string,
    message: HubToMachineMessage & { id: string }
  ): Promise<MessagesResponseMessage | TriggerResponseMessage> {
    return new Promise((resolve, reject) => {
      const sent = this.send(machineName, message);
      if (!sent) {
        reject(new Error(`Machine ${machineName} not connected`));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error(`Request ${message.id} timed out`));
      }, WS_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(message.id, { resolve, timer });
    });
  }

  /**
   * Handle a response message from a machine (correlates with pending request).
   * Returns true if the response matched a pending request.
   */
  handleResponse(msg: MessagesResponseMessage | TriggerResponseMessage): boolean {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);
    pending.resolve(msg);
    return true;
  }

  /**
   * Get all connected machine names.
   */
  getConnectedNames(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Find machine name by its WebSocket instance.
   */
  findBySocket(ws: ServerWebSocket<WsConnectionData>): string | undefined {
    for (const [name, conn] of this.connections) {
      if (conn === ws) return name;
    }
    return undefined;
  }

  /**
   * Clean up all connections and pending requests.
   */
  close(): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingRequests.clear();
    for (const ws of this.connections.values()) {
      try { ws.close(1000, "shutdown"); } catch {}
    }
    this.connections.clear();
  }
}

// ABOUTME: Machine-side WebSocket client for hub communication.
// ABOUTME: Replaces HTTP-based heartbeat with persistent bidirectional connection.

import type { AgentStatus } from "./types";
import type { AgentCompletionInfo } from "./orchestrator";
import type {
  MachineToHubMessage,
  HubToMachineMessage,
  GetMessagesMessage,
  TriggerMessage,
} from "./ws-protocol";
import { parseWsMessage, WS_PING_INTERVAL_MS } from "./ws-protocol";

export interface HubConnectionConfig {
  hubUrl: string;
  machineName: string;
  token?: string;
  intervalMs?: number;
  onStopCommand?: (agentKey: string, reason: string) => void;
  onWebhook?: (payload: string, signature: string | null, routing?: {
    localRepoPath?: string;
    linearApiKey?: string;
    promptTemplate?: string;
  }) => void;
  onGetMessages?: (agentKey: string) => Promise<unknown[]>;
  onTrigger?: (agentKey: string, message: string) => Promise<boolean>;
}

const DEFAULT_INTERVAL_MS = 2_000;
const IDLE_INTERVAL_MS = 60_000;
const IDLE_STOP_THRESHOLD_MS = 120_000;

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export class HubConnection {
  private config: HubConnectionConfig;
  private getAgents: () => Promise<AgentStatus[]>;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = MIN_RECONNECT_MS;
  private lastAgentCount = -1;
  private idleStartTime: number | null = null;
  private isStopped = false;
  private isShuttingDown = false;
  private authenticated = false;

  constructor(config: HubConnectionConfig, getAgents: () => Promise<AgentStatus[]>) {
    this.config = config;
    this.getAgents = getAgents;
  }

  /**
   * Start the connection to the hub.
   */
  start(): void {
    if (this.isShuttingDown) return;
    this.connect();
  }

  /**
   * Called when agent count changes — send immediate heartbeat and resume if idle-stopped.
   */
  notifyAgentChange(): void {
    if (this.isStopped) {
      this.isStopped = false;
      this.idleStartTime = null;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connect();
      }
      console.log("[HubConnection] Resumed after agent activity detected");
    }
    this.sendHeartbeat();
  }

  /**
   * Report an agent completion to the hub.
   */
  reportCompletion(info: AgentCompletionInfo): void {
    this.sendMessage({
      type: "agent-complete",
      completion: {
        key: info.key,
        issueId: info.issueId,
        issueIdentifier: info.issueIdentifier,
        issueTitle: info.issueTitle,
        linearProject: info.linearProject,
        completionReason: info.completionReason,
        finalLinearState: info.finalLinearState,
        duration: info.duration,
      },
    });
  }

  /**
   * Stop the connection and clean up.
   */
  stop(): void {
    this.isShuttingDown = true;
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(1000, "shutdown"); } catch {}
      this.ws = null;
    }
    console.log("[HubConnection] Stopped");
  }

  private connect(): void {
    if (this.isShuttingDown) return;

    // Convert http(s) URL to ws(s) URL
    const wsUrl = this.config.hubUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:")
      .replace(/\/$/, "") + "/ws";

    console.log(`[HubConnection] Connecting to ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.warn(`[HubConnection] Failed to create WebSocket: ${err instanceof Error ? err.message : "Unknown"}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[HubConnection] Connected, authenticating...");
      this.reconnectDelay = MIN_RECONNECT_MS;
      this.authenticate();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onclose = (event: CloseEvent) => {
      console.log(`[HubConnection] Disconnected (code=${event.code}, reason=${event.reason || "none"})`);
      this.authenticated = false;
      this.clearTimers();
      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event: Event) => {
      console.warn(`[HubConnection] WebSocket error`);
    };
  }

  private authenticate(): void {
    if (!this.config.token) {
      console.warn("[HubConnection] No token configured, cannot authenticate");
      return;
    }

    const tokenHash = new Bun.CryptoHasher("sha256")
      .update(this.config.token)
      .digest("hex");

    this.sendMessage({
      type: "auth",
      tokenHash,
      machineName: this.config.machineName,
    });
  }

  private handleMessage(data: string | Buffer | ArrayBuffer): void {
    const raw = typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf-8");
    const msg = parseWsMessage(raw);
    if (!msg) {
      console.warn("[HubConnection] Received unparseable message");
      return;
    }

    switch (msg.type) {
      case "auth-ok":
        this.authenticated = true;
        console.log("[HubConnection] Authenticated successfully");
        this.startHeartbeat();
        this.startPing();
        break;

      case "auth-fail":
        console.error(`[HubConnection] Authentication failed: ${msg.reason}`);
        this.isShuttingDown = true; // Don't reconnect on auth failure
        this.ws?.close(1000, "auth-fail");
        break;

      case "webhook":
        console.log("[HubConnection] Received webhook from hub");
        this.config.onWebhook?.(msg.payload, msg.signature, msg.routing);
        break;

      case "stop":
        console.log(`[HubConnection] Received stop command for ${msg.agentKey} (${msg.reason})`);
        this.config.onStopCommand?.(msg.agentKey, msg.reason);
        break;

      case "heartbeat-ack":
        // No-op, connection is alive
        break;

      case "get-messages":
        this.handleGetMessages(msg);
        break;

      case "trigger":
        this.handleTrigger(msg);
        break;
    }
  }

  private async handleGetMessages(msg: GetMessagesMessage): Promise<void> {
    try {
      const messages = await this.config.onGetMessages?.(msg.agentKey) ?? [];
      this.sendMessage({
        type: "messages-response",
        id: msg.id,
        messages,
      });
    } catch (err) {
      this.sendMessage({
        type: "messages-response",
        id: msg.id,
        messages: [],
      });
    }
  }

  private async handleTrigger(msg: TriggerMessage): Promise<void> {
    try {
      const success = await this.config.onTrigger?.(msg.agentKey, msg.message) ?? false;
      this.sendMessage({
        type: "trigger-response",
        id: msg.id,
        success,
      });
    } catch {
      this.sendMessage({
        type: "trigger-response",
        id: msg.id,
        success: false,
      });
    }
  }

  async sendHeartbeat(): Promise<void> {
    if (!this.authenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const agents = await this.getAgents();

      this.sendMessage({
        type: "heartbeat",
        agents,
      });

      const previousCount = this.lastAgentCount;
      this.lastAgentCount = agents.length;

      // Track idle time
      if (agents.length === 0) {
        if (this.idleStartTime === null) {
          this.idleStartTime = Date.now();
        } else if (Date.now() - this.idleStartTime > IDLE_STOP_THRESHOLD_MS) {
          this.stopForIdle();
          return;
        }
      } else {
        this.idleStartTime = null;
      }

      // Adjust interval on state change
      const isFirstRun = previousCount === -1;
      const becameActive = previousCount === 0 && agents.length > 0;
      const becameIdle = previousCount > 0 && agents.length === 0;
      if (isFirstRun || becameActive || becameIdle) {
        this.updateHeartbeatInterval();
      }
    } catch (err) {
      console.warn(`[HubConnection] Heartbeat failed: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  private sendMessage(msg: MachineToHubMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // Will reconnect on close
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Send initial heartbeat
    this.sendHeartbeat();

    const interval = this.config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval);
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.ping(); } catch {}
      }
    }, WS_PING_INTERVAL_MS);
  }

  private updateHeartbeatInterval(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);

    const interval = this.lastAgentCount > 0
      ? (this.config.intervalMs ?? DEFAULT_INTERVAL_MS)
      : IDLE_INTERVAL_MS;

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval);
    console.log(`[HubConnection] Heartbeat interval: ${interval / 1000}s (${this.lastAgentCount > 0 ? "active" : "idle"})`);
  }

  private stopForIdle(): void {
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(1000, "idle"); } catch {}
      this.ws = null;
    }
    this.isStopped = true;
    this.authenticated = false;
    console.log("[HubConnection] Disconnected after 2 minutes idle (allowing hibernation)");
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.isStopped) return;

    // Add jitter: ±25% of delay
    const jitter = this.reconnectDelay * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.round(this.reconnectDelay + jitter);

    console.log(`[HubConnection] Reconnecting in ${(delay / 1000).toFixed(1)}s`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

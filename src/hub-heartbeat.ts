// ABOUTME: Sends status heartbeats from machine to hub.
// ABOUTME: Enables push-based status updates, preventing hub from polling idle machines.

import type { AgentStatus } from "./types";
import type { AgentCompletionInfo } from "./orchestrator";

export interface HubHeartbeatConfig {
  hubUrl: string;
  machineName: string;
  machineUrl: string;
  apiKey?: string;
  token?: string;
  intervalMs?: number;
  onStopCommand?: (agentKey: string, reason: string) => void;
}

const DEFAULT_INTERVAL_MS = 2000; // Match dashboard poll rate for real-time feel
const IDLE_INTERVAL_MS = 60_000; // Slower when no agents to allow hibernation
const IDLE_STOP_THRESHOLD_MS = 120_000; // Stop heartbeats after 2 minutes idle

export class HubHeartbeat {
  private config: Required<Omit<HubHeartbeatConfig, "apiKey" | "token">> & { apiKey?: string; token?: string };
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private getAgents: () => Promise<AgentStatus[]>;
  private lastAgentCount = -1; // -1 means unknown (first run)
  private idleStartTime: number | null = null;
  private isStopped = false;

  constructor(config: HubHeartbeatConfig, getAgents: () => Promise<AgentStatus[]>) {
    this.config = {
      ...config,
      intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
    };
    this.getAgents = getAgents;
  }

  async sendHeartbeat(): Promise<void> {
    try {
      const agents = await this.getAgents();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }
      if (this.config.token) {
        const hash = new Bun.CryptoHasher("sha256").update(this.config.token).digest("hex");
        headers["X-Machine-Token-Hash"] = hash;
      }

      const response = await fetch(`${this.config.hubUrl}/hub/heartbeat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          machineName: this.config.machineName,
          machineUrl: this.config.machineUrl,
          agents,
        }),
      });

      if (!response.ok) {
        console.warn(`[HubHeartbeat] Failed: HTTP ${response.status}`);
      } else {
        // Process commands from hub
        try {
          const body = await response.json() as { commands?: { stop?: Array<{ agentKey: string; reason: string }> } };
          const stopCommands = body?.commands?.stop ?? [];
          for (const cmd of stopCommands) {
            console.log(`[HubHeartbeat] Received stop command for ${cmd.agentKey} (${cmd.reason})`);
            this.config.onStopCommand?.(cmd.agentKey, cmd.reason);
          }
        } catch {
          // Hub may return non-JSON (backward compatibility)
        }
      }

      // Track agent count for adaptive interval
      const previousCount = this.lastAgentCount;
      this.lastAgentCount = agents.length;

      // Track idle time
      if (agents.length === 0) {
        if (this.idleStartTime === null) {
          this.idleStartTime = Date.now();
        } else if (Date.now() - this.idleStartTime > IDLE_STOP_THRESHOLD_MS) {
          // Been idle for 2+ minutes, stop heartbeats entirely
          this.stopForIdle();
          return;
        }
      } else {
        this.idleStartTime = null;
      }

      // Adjust interval on first run or if agent count changed between active/idle
      const isFirstRun = previousCount === -1;
      const becameActive = previousCount === 0 && agents.length > 0;
      const becameIdle = previousCount > 0 && agents.length === 0;
      if (isFirstRun || becameActive || becameIdle) {
        this.updateInterval();
      }
    } catch (err) {
      console.warn(`[HubHeartbeat] Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  /**
   * Called when agent count changes - send immediate heartbeat and resume if stopped.
   */
  notifyAgentChange(): void {
    // Resume heartbeats if they were stopped due to idle
    if (this.isStopped) {
      this.isStopped = false;
      this.idleStartTime = null;
      this.start();
      console.log("[HubHeartbeat] Resumed after agent activity detected");
    }
    this.sendHeartbeat();
  }

  private stopForIdle(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isStopped = true;
    console.log("[HubHeartbeat] Stopped after 2 minutes idle (allowing hibernation)");
  }

  private updateInterval(): void {
    if (!this.intervalId) return;

    clearInterval(this.intervalId);

    const interval = this.lastAgentCount > 0 ? this.config.intervalMs : IDLE_INTERVAL_MS;

    this.intervalId = setInterval(() => this.sendHeartbeat(), interval);

    console.log(
      `[HubHeartbeat] Interval adjusted to ${interval / 1000}s (${this.lastAgentCount > 0 ? "active" : "idle"})`
    );
  }

  start(): void {
    if (this.intervalId) return;

    // Send initial heartbeat
    this.sendHeartbeat();

    // Start with default interval
    this.intervalId = setInterval(() => this.sendHeartbeat(), this.config.intervalMs);

    console.log(`[HubHeartbeat] Started sending heartbeats to ${this.config.hubUrl}`);
  }

  async reportCompletion(info: AgentCompletionInfo): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.apiKey) {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }
      if (this.config.token) {
        const hash = new Bun.CryptoHasher("sha256").update(this.config.token).digest("hex");
        headers["X-Machine-Token-Hash"] = hash;
      }

      const response = await fetch(`${this.config.hubUrl}/hub/agent-complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          machineName: this.config.machineName,
          completion: info,
        }),
      });

      if (!response.ok) {
        console.warn(`[HubHeartbeat] Failed to report completion: HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn(`[HubHeartbeat] Failed to report completion: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[HubHeartbeat] Stopped");
    }
  }
}

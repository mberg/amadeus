// ABOUTME: Sends status heartbeats from machine to hub.
// ABOUTME: Enables push-based status updates, preventing hub from polling idle machines.

import type { AgentStatus } from "./types";

export interface HubHeartbeatConfig {
  hubUrl: string;
  machineName: string;
  machineUrl: string;
  apiKey?: string;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 2000; // Match dashboard poll rate for real-time feel
const IDLE_INTERVAL_MS = 60_000; // Slower when no agents to allow hibernation

export class HubHeartbeat {
  private config: Required<Omit<HubHeartbeatConfig, "apiKey">> & { apiKey?: string };
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private getAgents: () => Promise<AgentStatus[]>;
  private lastAgentCount = 0;

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
      }

      // Track agent count for adaptive interval
      const previousCount = this.lastAgentCount;
      this.lastAgentCount = agents.length;

      // Adjust interval if agent count changed between active/idle
      if ((previousCount === 0 && agents.length > 0) || (previousCount > 0 && agents.length === 0)) {
        this.updateInterval();
      }
    } catch (err) {
      console.warn(`[HubHeartbeat] Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  /**
   * Called when agent count changes - send immediate heartbeat.
   */
  notifyAgentChange(): void {
    this.sendHeartbeat();
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

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[HubHeartbeat] Stopped");
    }
  }
}

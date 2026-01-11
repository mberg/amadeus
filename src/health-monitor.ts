// ABOUTME: Monitors agent health via periodic HTTP checks and conversation snapshots.
// ABOUTME: Detects unresponsive agents and persists state for recovery.

import type { AgentPersistence } from "./persistence";

export interface AgentInfo {
  key: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  projectPath: string;
  worktreePath?: string;
  port: number;
  linearState?: string;
}

export interface UnresponsiveAgentInfo {
  key: string;
  issueId: string;
  issueIdentifier: string;
  port: number;
  error: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  status?: string;
  error?: string;
}

export interface HealthMonitorConfig {
  persistence: AgentPersistence;
  getAgents: () => AgentInfo[];
  onAgentUnresponsive: (info: UnresponsiveAgentInfo) => void;
  checkIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_CHECK_INTERVAL_MS = 30000; // 30 seconds
const DEFAULT_TIMEOUT_MS = 5000; // 5 seconds

export class HealthMonitor {
  private config: HealthMonitorConfig;
  private checkIntervalMs: number;
  private timeoutMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: HealthMonitorConfig) {
    this.config = config;
    this.checkIntervalMs = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getCheckInterval(): number {
    return this.checkIntervalMs;
  }

  getTimeout(): number {
    return this.timeoutMs;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    console.log(`[HealthMonitor] Starting health checks every ${this.checkIntervalMs}ms`);

    // Run initial check
    this.runHealthCheck().catch((err) => {
      console.error("[HealthMonitor] Initial health check failed:", err);
    });

    // Set up periodic checks
    this.intervalId = setInterval(() => {
      this.runHealthCheck().catch((err) => {
        console.error("[HealthMonitor] Health check failed:", err);
      });
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[HealthMonitor] Stopped health checks");
  }

  async runHealthCheck(): Promise<void> {
    const agents = this.config.getAgents();

    for (const agent of agents) {
      const health = await this.checkAgentHealth(agent.port);

      if (health.healthy) {
        // Agent is responsive, save snapshot
        await this.saveAgentSnapshot(agent);
      } else {
        // Agent is unresponsive
        console.log(
          `[HealthMonitor] Agent ${agent.key} unresponsive: ${health.error}`
        );

        // Mark as dead in persistence
        this.config.persistence.markAgentDead(agent.issueId);

        // Notify caller
        this.config.onAgentUnresponsive({
          key: agent.key,
          issueId: agent.issueId,
          issueIdentifier: agent.issueIdentifier,
          port: agent.port,
          error: health.error ?? "Unknown error",
        });
      }
    }
  }

  async checkAgentHealth(port: number): Promise<HealthCheckResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(`http://localhost:${port}/status`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        return {
          healthy: false,
          error: `HTTP ${res.status}`,
        };
      }

      const data = await res.json();
      return {
        healthy: true,
        status: data.status,
      };
    } catch (err) {
      return {
        healthy: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async fetchConversation(port: number): Promise<unknown[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(`http://localhost:${port}/messages`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        return [];
      }

      const data = await res.json();
      return data.messages ?? [];
    } catch {
      return [];
    }
  }

  async saveAgentSnapshot(agent: AgentInfo): Promise<void> {
    const conversation = await this.fetchConversation(agent.port);

    this.config.persistence.saveAgentState({
      key: agent.key,
      issueId: agent.issueId,
      issueIdentifier: agent.issueIdentifier,
      issueTitle: agent.issueTitle,
      projectPath: agent.projectPath,
      worktreePath: agent.worktreePath,
      linearState: agent.linearState,
      port: agent.port,
      status: "alive",
      conversationSnapshot: conversation,
      lastHeartbeat: new Date(),
    });
  }
}

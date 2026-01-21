// ABOUTME: Machine registry for hub mode.
// ABOUTME: Tracks known machines and their status via push-based heartbeats.

import type { AgentStatus } from "../types";

export interface MachineInfo {
  name: string;
  url: string;
  apiKey?: string;
  lastSeen?: Date;
  lastHeartbeat?: Date;
  agentCount?: number;
  agents?: AgentStatus[];
  status: "unknown" | "healthy" | "unhealthy" | "dormant";
}

export class MachineRegistry {
  private machines = new Map<string, MachineInfo>();

  /**
   * Register or update a machine.
   */
  register(name: string, url: string, apiKey?: string): void {
    this.machines.set(name, {
      name,
      url,
      apiKey,
      lastSeen: new Date(),
      status: "unknown",
    });
  }

  /**
   * Get all registered machines.
   */
  getAll(): MachineInfo[] {
    return Array.from(this.machines.values());
  }

  /**
   * Get a machine by name.
   */
  get(name: string): MachineInfo | undefined {
    return this.machines.get(name);
  }

  /**
   * Update machine status from heartbeat.
   */
  updateStatus(name: string, status: MachineInfo["status"], agents?: AgentStatus[]): void {
    const machine = this.machines.get(name);
    if (machine) {
      machine.status = status;
      machine.agents = agents;
      machine.agentCount = agents?.length ?? 0;
      machine.lastHeartbeat = new Date();
      machine.lastSeen = new Date();
    }
  }

  /**
   * Get cached status for all machines.
   * Marks machines as dormant if no heartbeat received in 2+ minutes.
   */
  getCachedStatus(): Array<MachineInfo & { agents: AgentStatus[] }> {
    const now = Date.now();
    const DORMANT_THRESHOLD_MS = 5_000; // 5 seconds (machines already wait 2 min before stopping)

    return Array.from(this.machines.values()).map(m => ({
      ...m,
      agents: m.agents ?? [],
      status: m.lastHeartbeat && (now - m.lastHeartbeat.getTime() > DORMANT_THRESHOLD_MS)
        ? "dormant" as const
        : m.status,
    }));
  }

  /**
   * Load machines from static config.
   */
  loadFromConfig(machines: Array<{ name: string; url: string; apiKey?: string }>): void {
    for (const m of machines) {
      this.register(m.name, m.url, m.apiKey);
    }
  }
}

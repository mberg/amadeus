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

export interface AgentIdleInfo {
  idleStartTime?: Date;
  linearState?: string;
}

export class MachineRegistry {
  private machines = new Map<string, MachineInfo>();
  private agentIdleTracking = new Map<string, AgentIdleInfo>();

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

      // Track idle state for each agent
      if (agents) {
        for (const agent of agents) {
          this.trackAgentIdleState(name, agent.key, agent.linearState);
        }
      }
    }
  }

  /**
   * Track when an agent enters or leaves an idle state.
   * Only sets idleStartTime for states that indicate waiting (contain "Needs" or "Blocked").
   */
  private trackAgentIdleState(machineName: string, agentKey: string, linearState?: string): void {
    const trackingKey = `${machineName}:${agentKey}`;
    const existing = this.agentIdleTracking.get(trackingKey);

    if (!linearState) {
      // No linear state - clear tracking
      this.agentIdleTracking.delete(trackingKey);
      return;
    }

    // Determine if this state is considered "idle" (waiting for something)
    const isIdleState = linearState.includes("Needs") || linearState.includes("Blocked");

    if (isIdleState) {
      // Only set/update idle tracking for idle states
      if (!existing || existing.linearState !== linearState) {
        // New idle state or idle state changed - set new timer
        this.agentIdleTracking.set(trackingKey, {
          idleStartTime: new Date(),
          linearState,
        });
      }
      // If same idle state as before, keep existing timer (don't reset)
    } else {
      // Non-idle state - track state but don't set idleStartTime
      this.agentIdleTracking.set(trackingKey, {
        linearState,
      });
    }
  }

  /**
   * Get idle tracking info for a specific agent.
   */
  getAgentIdleInfo(machineName: string, agentKey: string): AgentIdleInfo | undefined {
    return this.agentIdleTracking.get(`${machineName}:${agentKey}`);
  }

  /**
   * Get agents that have been in an idle state longer than the threshold.
   */
  getIdleAgents(idleStates: string[], thresholdMs: number): Array<{
    machineName: string;
    agentKey: string;
    idleStartTime: Date;
    linearState: string;
  }> {
    const now = Date.now();
    const results: Array<{
      machineName: string;
      agentKey: string;
      idleStartTime: Date;
      linearState: string;
    }> = [];

    for (const [trackingKey, info] of this.agentIdleTracking) {
      if (!info.idleStartTime || !info.linearState) continue;
      if (!idleStates.includes(info.linearState)) continue;

      const idleDuration = now - info.idleStartTime.getTime();
      if (idleDuration >= thresholdMs) {
        const [machineName, agentKey] = trackingKey.split(":");
        results.push({
          machineName,
          agentKey,
          idleStartTime: info.idleStartTime,
          linearState: info.linearState,
        });
      }
    }

    return results;
  }

  /**
   * Remove idle tracking for a specific agent.
   */
  clearAgentIdleTracking(machineName: string, agentKey: string): void {
    this.agentIdleTracking.delete(`${machineName}:${agentKey}`);
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

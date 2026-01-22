// ABOUTME: Scans for idle agents and terminates them to save costs.
// ABOUTME: Runs on hub, checks heartbeat data for agents stuck in idle states.

import type { MachineRegistry } from "./registry";

export interface IdleScannerConfig {
  enabled: boolean;
  timeoutMinutes: number;
  idleStates: string[];
  scanIntervalSeconds: number;
}

export class IdleScanner {
  private config: IdleScannerConfig;
  private registry: MachineRegistry;
  private stopAgent: (machineUrl: string, agentKey: string) => Promise<void>;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: IdleScannerConfig,
    registry: MachineRegistry,
    stopAgent: (machineUrl: string, agentKey: string) => Promise<void>
  ) {
    this.config = config;
    this.registry = registry;
    this.stopAgent = stopAgent;
  }

  /**
   * Scan for idle agents and terminate them.
   */
  async scan(): Promise<void> {
    if (!this.config.enabled) return;

    const thresholdMs = this.config.timeoutMinutes * 60 * 1000;
    const idleAgents = this.registry.getIdleAgents(this.config.idleStates, thresholdMs);

    for (const agent of idleAgents) {
      const machine = this.registry.get(agent.machineName);
      if (!machine) continue;

      const idleDurationMs = Date.now() - agent.idleStartTime.getTime();
      const idleMinutes = Math.round(idleDurationMs / 60_000);
      console.log(
        `[IdleScanner] Agent ${agent.agentKey} idle for ${idleMinutes}m in "${agent.linearState}" - terminating`
      );

      try {
        await this.stopAgent(machine.url, agent.agentKey);
        this.registry.clearAgentIdleTracking(agent.machineName, agent.agentKey);
        console.log(
          `[IdleScanner] Sent stop command to ${agent.machineName} for ${agent.agentKey}`
        );
      } catch (err) {
        console.warn(
          `[IdleScanner] Failed to stop ${agent.agentKey}: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }
  }

  /**
   * Start the periodic scanner.
   */
  start(): void {
    if (!this.config.enabled) {
      console.log("[IdleScanner] Disabled, not starting");
      return;
    }

    if (this.intervalId) return;

    this.intervalId = setInterval(
      () => this.scan(),
      this.config.scanIntervalSeconds * 1000
    );

    console.log(
      `[IdleScanner] Started, checking every ${this.config.scanIntervalSeconds}s for agents idle >${this.config.timeoutMinutes}m in: ${this.config.idleStates.join(", ")}`
    );
  }

  /**
   * Stop the periodic scanner.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[IdleScanner] Stopped");
    }
  }
}

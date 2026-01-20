// ABOUTME: Machine registry for hub mode.
// ABOUTME: Tracks known machines and their status.

export interface MachineInfo {
  name: string;
  url: string;
  lastSeen?: Date;
  agentCount?: number;
  status: "unknown" | "healthy" | "unhealthy";
}

export class MachineRegistry {
  private machines = new Map<string, MachineInfo>();

  /**
   * Register or update a machine.
   */
  register(name: string, url: string): void {
    this.machines.set(name, {
      name,
      url,
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
   * Update machine status from health check.
   */
  updateStatus(name: string, status: MachineInfo["status"], agentCount?: number): void {
    const machine = this.machines.get(name);
    if (machine) {
      machine.status = status;
      machine.agentCount = agentCount;
      machine.lastSeen = new Date();
    }
  }

  /**
   * Load machines from static config.
   */
  loadFromConfig(machines: Array<{ name: string; url: string }>): void {
    for (const m of machines) {
      this.register(m.name, m.url);
    }
  }
}

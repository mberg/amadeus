// ABOUTME: Health monitoring for tracking machine heartbeats and availability.
// ABOUTME: Stores timestamps in KV and determines if machines are healthy.

export const HEALTH_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export interface HeartbeatStore {
  get(key: string): Promise<number | null>;
  put(key: string, timestamp: number): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<Array<{ machine: string; timestamp: number }>>;
}

export interface MachineStatus {
  machine: string;
  timestamp: number;
  healthy: boolean;
}

export class HealthMonitor {
  constructor(private store: HeartbeatStore) {}

  async recordHeartbeat(machine: string): Promise<void> {
    const timestamp = Date.now();
    await this.store.put(machine, timestamp);
  }

  async isHealthy(machine: string): Promise<boolean> {
    const timestamp = await this.store.get(machine);

    if (timestamp === null) {
      return false;
    }

    const age = Date.now() - timestamp;
    return age < HEALTH_THRESHOLD_MS;
  }

  async getLastHeartbeat(machine: string): Promise<number | null> {
    return this.store.get(machine);
  }

  async getAllStatus(): Promise<MachineStatus[]> {
    const entries = await this.store.list();
    const now = Date.now();

    return entries.map(({ machine, timestamp }) => ({
      machine,
      timestamp,
      healthy: now - timestamp < HEALTH_THRESHOLD_MS,
    }));
  }

  async removeMachine(machine: string): Promise<void> {
    await this.store.delete(machine);
  }
}

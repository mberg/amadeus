// ABOUTME: Heartbeat sender for multi-machine router integration.
// ABOUTME: Periodically sends heartbeats to the Cloudflare Worker router.

export interface RouterHeartbeatConfig {
  routerUrl: string;
  machineName: string;
  secret: string;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000; // 60 seconds

export class RouterHeartbeat {
  private config: Required<RouterHeartbeatConfig>;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: RouterHeartbeatConfig) {
    this.config = {
      ...config,
      intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
    };
  }

  async sendHeartbeat(): Promise<void> {
    try {
      const response = await fetch(`${this.config.routerUrl}/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          machine: this.config.machineName,
          secret: this.config.secret,
        }),
      });

      if (!response.ok) {
        console.warn(
          `[RouterHeartbeat] Failed to send heartbeat: HTTP ${response.status}`
        );
      }
    } catch (err) {
      console.warn(
        `[RouterHeartbeat] Failed to send heartbeat: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    // Send initial heartbeat
    this.sendHeartbeat();

    // Schedule periodic heartbeats
    this.intervalId = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.intervalMs);

    console.log(
      `[RouterHeartbeat] Started sending heartbeats to ${this.config.routerUrl} as "${this.config.machineName}"`
    );
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[RouterHeartbeat] Stopped sending heartbeats");
    }
  }

  static isConfigured(env: Record<string, string | undefined>): boolean {
    return !!(env.routerUrl && env.machineName && env.routerSecret);
  }
}

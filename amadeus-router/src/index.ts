// ABOUTME: Cloudflare Worker entry point for the Amadeus multi-machine router.
// ABOUTME: Receives Linear webhooks and routes them to the appropriate Tailscale machine.

import { findTargetMachine, type RouterConfig, type IssueInfo } from "./routing";
import { HealthMonitor, type HeartbeatStore } from "./health";
import {
  verifyLinearSignature,
  extractIssueInfo,
  postLinearComment,
  type LinearWebhookPayload,
} from "./linear";

interface Env {
  ROUTER_KV: KVNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  LINEAR_API_KEY: string;
  ROUTER_SECRET: string;
  ROUTER_CONFIG: string;
}

class KVHeartbeatStore implements HeartbeatStore {
  constructor(private kv: KVNamespace) {}

  async get(key: string): Promise<number | null> {
    const value = await this.kv.get(`heartbeat:${key}`);
    return value ? parseInt(value, 10) : null;
  }

  async put(key: string, timestamp: number): Promise<void> {
    await this.kv.put(`heartbeat:${key}`, timestamp.toString());
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(`heartbeat:${key}`);
  }

  async list(): Promise<Array<{ machine: string; timestamp: number }>> {
    const list = await this.kv.list({ prefix: "heartbeat:" });
    const results: Array<{ machine: string; timestamp: number }> = [];

    for (const key of list.keys) {
      const value = await this.kv.get(key.name);
      if (value) {
        results.push({
          machine: key.name.replace("heartbeat:", ""),
          timestamp: parseInt(value, 10),
        });
      }
    }

    return results;
  }
}

function parseConfig(configStr: string): RouterConfig {
  return JSON.parse(configStr) as RouterConfig;
}

async function forwardWebhook(
  targetUrl: string,
  payload: string,
  secret: string
): Promise<{ success: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Amadeus-Secret": secret,
      },
      body: payload,
    });

    return {
      success: response.ok,
      status: response.status,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("OK");
    }

    // Heartbeat endpoint - machines report they're alive
    if (request.method === "POST" && url.pathname === "/heartbeat") {
      try {
        const body = await request.json() as { machine?: string; secret?: string };

        if (!body.machine || body.secret !== env.ROUTER_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }

        const store = new KVHeartbeatStore(env.ROUTER_KV);
        const monitor = new HealthMonitor(store);
        await monitor.recordHeartbeat(body.machine);

        return new Response("OK");
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
    }

    // Status endpoint - show all machines and their health
    if (request.method === "GET" && url.pathname === "/status") {
      const authHeader = request.headers.get("Authorization");
      if (authHeader !== env.ROUTER_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const store = new KVHeartbeatStore(env.ROUTER_KV);
      const monitor = new HealthMonitor(store);
      const status = await monitor.getAllStatus();

      let config: RouterConfig;
      try {
        config = parseConfig(env.ROUTER_CONFIG);
      } catch {
        return Response.json({ error: "Invalid config" }, { status: 500 });
      }

      const machines = Object.entries(config.machines).map(([name, machine]) => {
        const healthStatus = status.find((s) => s.machine === name);
        return {
          name,
          url: machine.url,
          labels: machine.labels,
          projects: machine.projects,
          default: machine.default ?? false,
          lastHeartbeat: healthStatus?.timestamp ?? null,
          healthy: healthStatus?.healthy ?? false,
        };
      });

      return Response.json({
        machines,
        timestamp: Date.now(),
      });
    }

    // Config update endpoint
    if (request.method === "POST" && url.pathname === "/config") {
      const authHeader = request.headers.get("Authorization");
      if (authHeader !== env.ROUTER_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      try {
        const newConfig = await request.text();
        // Validate it's valid JSON
        JSON.parse(newConfig);
        // In production, you'd update the secret/KV here
        // For now, return success - config is managed via wrangler
        return Response.json({ success: true, note: "Update ROUTER_CONFIG secret via wrangler" });
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
    }

    // Main webhook endpoint - receives Linear webhooks
    if (request.method === "POST" && url.pathname === "/webhook") {
      const payload = await request.text();
      const signature = request.headers.get("linear-signature");

      // Verify Linear signature
      const verified = await verifyLinearSignature(
        payload,
        signature,
        env.LINEAR_WEBHOOK_SECRET
      );

      if (!verified) {
        console.error("[Router] Invalid Linear signature");
        return new Response("Unauthorized", { status: 401 });
      }

      let webhookData: LinearWebhookPayload;
      try {
        webhookData = JSON.parse(payload) as LinearWebhookPayload;
      } catch {
        console.error("[Router] Invalid JSON payload");
        return new Response("Bad Request", { status: 400 });
      }

      // Validate timestamp to prevent replay attacks
      const MAX_AGE_MS = 60000;
      const now = Date.now();
      if (
        !webhookData.webhookTimestamp ||
        Math.abs(now - webhookData.webhookTimestamp) > MAX_AGE_MS
      ) {
        console.error("[Router] Timestamp validation failed");
        return new Response("Unauthorized", { status: 401 });
      }

      // Extract issue info from webhook
      const issueInfo = extractIssueInfo(webhookData);
      if (!issueInfo) {
        // Not an Issue or Comment webhook - ignore
        return new Response("OK");
      }

      // Load router config
      let config: RouterConfig;
      try {
        config = parseConfig(env.ROUTER_CONFIG);
      } catch (err) {
        console.error("[Router] Failed to parse config:", err);
        return new Response("Internal Error", { status: 500 });
      }

      // Find target machine
      const target = findTargetMachine(issueInfo, config);
      if (!target) {
        console.log(`[Router] No target machine for ${issueInfo.identifier}`);
        await postLinearComment({
          issueIdentifier: issueInfo.identifier,
          body: "⚠️ No target machine configured for this issue. Check routing configuration.",
          apiKey: env.LINEAR_API_KEY,
        });
        return new Response("OK");
      }

      // Check machine health
      const store = new KVHeartbeatStore(env.ROUTER_KV);
      const monitor = new HealthMonitor(store);
      const healthy = await monitor.isHealthy(target.name);

      if (!healthy) {
        console.log(`[Router] Machine ${target.name} is offline for ${issueInfo.identifier}`);
        await postLinearComment({
          issueIdentifier: issueInfo.identifier,
          body: `⚠️ Target machine '${target.name}' is currently offline.\nMove issue back to Planning when ready to retry.`,
          apiKey: env.LINEAR_API_KEY,
        });
        return new Response("OK");
      }

      // Forward webhook to target machine
      console.log(`[Router] Forwarding ${issueInfo.identifier} to ${target.name} (${target.reason})`);
      const result = await forwardWebhook(
        `${target.url}/webhook`,
        payload,
        config.secret
      );

      if (!result.success) {
        console.error(`[Router] Failed to forward to ${target.name}:`, result.error ?? result.status);
        await postLinearComment({
          issueIdentifier: issueInfo.identifier,
          body: `⚠️ Failed to reach machine '${target.name}' (${result.error ?? `HTTP ${result.status}`}).\nMove issue back to Planning when ready to retry.`,
          apiKey: env.LINEAR_API_KEY,
        });
      }

      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  },
};

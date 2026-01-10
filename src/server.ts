// ABOUTME: Amadeus orchestrator server - receives Linear webhooks and manages Claude Code agents.
// ABOUTME: Entry point for the Bun server.

import { CONFIG } from "./config";
import { verifyLinearSignature } from "./signature";
import { ClaudeOrchestrator } from "./orchestrator";
import type { LinearWebhookPayload } from "./types";

const orchestrator = new ClaudeOrchestrator({
  projectPaths: CONFIG.projectPaths,
  triggerStates: CONFIG.triggerStates,
  claudeBotUserId: CONFIG.claudeBotUserId,
});

async function handleWebhook(payload: LinearWebhookPayload): Promise<void> {
  const { action, type, data } = payload;

  if (type !== "Issue") return;

  const agentKey = orchestrator.getAgentKey(data);

  console.log(
    `[${new Date().toISOString()}] ${type} ${action}: ${data.identifier} - ${data.title}`
  );

  if (action === "remove") {
    await orchestrator.stopAgent(agentKey);
    return;
  }

  if (orchestrator.shouldStartAgent(data)) {
    if (orchestrator.hasAgent(agentKey)) {
      const { buildPrompt } = await import("./prompt");
      await orchestrator.sendMessage(agentKey, buildPrompt(data));
    } else {
      await orchestrator.startAgent(data);
    }
  }
}

export const server = Bun.serve({
  port: CONFIG.port,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("OK");
    }

    // Linear webhook endpoint
    if (req.method === "POST" && url.pathname === "/webhook") {
      const payload = await req.text();
      const signature = req.headers.get("linear-signature");

      if (
        !(await verifyLinearSignature(
          payload,
          signature,
          CONFIG.linearWebhookSecret
        ))
      ) {
        console.warn("[Webhook] Invalid signature");
        return new Response("Unauthorized", { status: 401 });
      }

      const data = JSON.parse(payload) as LinearWebhookPayload;

      // Process async, respond immediately
      handleWebhook(data).catch((err) => {
        console.error("[Webhook] Error handling webhook:", err);
      });

      return new Response("OK", { status: 200 });
    }

    // Status dashboard (JSON)
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({
        agents: orchestrator.getStatus(),
        timestamp: new Date().toISOString(),
      });
    }

    // Manual trigger endpoint
    if (req.method === "POST" && url.pathname === "/trigger") {
      try {
        const { agentKey, message } = await req.json();
        if (!agentKey || !message) {
          return new Response("Bad Request: agentKey and message required", { status: 400 });
        }
        await orchestrator.sendMessage(agentKey, message);
        return new Response("Sent");
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🎼 Amadeus listening on http://localhost:${server.port}`);
console.log(`   Webhook URL: https://your-machine.ts.net/webhook`);
console.log(`   Status: http://localhost:${server.port}/status`);

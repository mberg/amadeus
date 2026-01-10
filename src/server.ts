// ABOUTME: Amadeus orchestrator server - receives Linear webhooks and manages Claude Code agents.
// ABOUTME: Entry point for the Bun server.

import { CONFIG } from "./config";
import { verifyLinearSignature } from "./signature";
import { ClaudeOrchestrator } from "./orchestrator";
import { buildPrompt, buildCommentPrompt } from "./prompt";
import type { LinearWebhookPayload, LinearIssue, LinearComment } from "./types";

const dashboardHtml = await Bun.file(
  new URL("./dashboard.html", import.meta.url).pathname
).text();

const orchestrator = new ClaudeOrchestrator({
  projectPaths: CONFIG.projectPaths,
  triggerStates: CONFIG.triggerStates,
  claudeBotUserId: CONFIG.claudeBotUserId,
  useWorktrees: CONFIG.useWorktrees,
  worktreesDir: CONFIG.worktreesDir,
});

function isComment(data: LinearIssue | LinearComment): data is LinearComment {
  return "body" in data && "issueId" in data;
}

function isDraft(issue: LinearIssue): boolean {
  // Draft issues have state type "triage" or state name containing "Draft"
  const stateType = issue.state?.type?.toLowerCase();
  const stateName = issue.state?.name?.toLowerCase() ?? "";
  return stateType === "triage" || stateName.includes("draft");
}

async function handleIssueWebhook(
  action: string,
  issue: LinearIssue
): Promise<void> {
  // Skip draft issues
  if (isDraft(issue)) {
    console.log(
      `[${new Date().toISOString()}] Skipping draft issue: ${issue.identifier}`
    );
    return;
  }

  const agentKey = orchestrator.getAgentKey(issue);

  console.log(
    `[${new Date().toISOString()}] Issue ${action}: ${issue.identifier} - ${issue.title}`
  );

  if (action === "remove") {
    await orchestrator.stopAgent(agentKey);
    return;
  }

  if (orchestrator.shouldStartAgent(issue)) {
    if (orchestrator.hasAgent(agentKey)) {
      await orchestrator.sendMessage(agentKey, buildPrompt(issue));
    } else {
      await orchestrator.startAgent(issue);
    }
  }
}

async function handleCommentWebhook(
  action: string,
  comment: LinearComment
): Promise<void> {
  // Only handle new comments
  if (action !== "create") return;

  // Skip comments on draft issues
  if (isDraft(comment.issue)) {
    console.log(
      `[${new Date().toISOString()}] Skipping comment on draft issue: ${comment.issue.identifier}`
    );
    return;
  }

  console.log(
    `[${new Date().toISOString()}] Comment ${action}: ${comment.issue.identifier} from ${comment.user?.name ?? "unknown"}`
  );

  let agentKey = orchestrator.findAgentByIssueId(comment.issueId);

  // Spawn a new agent if one doesn't exist for this issue
  if (!agentKey) {
    console.log(
      `[${new Date().toISOString()}] No active agent for ${comment.issue.identifier} - spawning new agent`
    );
    await orchestrator.startAgent(comment.issue);
    agentKey = orchestrator.findAgentByIssueId(comment.issueId);

    if (!agentKey) {
      console.error(
        `[${new Date().toISOString()}] Failed to spawn agent for ${comment.issue.identifier}`
      );
      return;
    }
  }

  await orchestrator.sendMessage(agentKey, buildCommentPrompt(comment));
}

async function handleWebhook(payload: LinearWebhookPayload): Promise<void> {
  const { action, type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    await handleIssueWebhook(action, data);
  } else if (type === "Comment" && isComment(data)) {
    await handleCommentWebhook(action, data);
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

    // Visual dashboard
    if (req.method === "GET" && url.pathname === "/dashboard") {
      return new Response(dashboardHtml, {
        headers: { "Content-Type": "text/html" },
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

    // Agent messages proxy endpoint
    const messagesMatch = url.pathname.match(/^\/agents\/([^/]+)\/messages$/);
    if (req.method === "GET" && messagesMatch) {
      const agentKey = decodeURIComponent(messagesMatch[1]);
      const agent = orchestrator.getStatus().find((a) => a.key === agentKey);

      if (!agent) {
        return new Response("Agent not found", { status: 404 });
      }

      try {
        const res = await fetch(`http://localhost:${agent.port}/messages`);
        const data = await res.json();
        return Response.json(data);
      } catch {
        return new Response("Failed to fetch agent messages", { status: 502 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  for (const status of orchestrator.getStatus()) {
    await orchestrator.stopAgent(status.key);
  }
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down...");
  for (const status of orchestrator.getStatus()) {
    await orchestrator.stopAgent(status.key);
  }
  server.stop();
  process.exit(0);
});

console.log(`🎼 Amadeus listening on http://localhost:${server.port}`);
console.log(`   Webhook:   https://your-machine.ts.net/webhook`);
console.log(`   Status:    http://localhost:${server.port}/status`);
console.log(`   Dashboard: http://localhost:${server.port}/dashboard`);

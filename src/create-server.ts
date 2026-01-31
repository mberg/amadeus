// ABOUTME: Factory for the HTTP fetch handler, decoupled from server startup.
// ABOUTME: Enables amadeus-cloud to wrap the handler with org resolution.

import { $ } from "bun";
import {
  CONFIG,
  REALM_CONFIG,
  getAllWebhookSecrets,
  getRealmByTeamKey,
  getSecurityConfig,
  getRouterConfig,
  getConfigYaml,
  validateConfigYaml,
  reloadConfig,
  getMachineConfig,
  getMachineUrlForProject,
  getRuntimeMode,
  isHubMode,
  isMachineMode,
  isStandaloneMode,
} from "./config";
import {
  recordCompletedTask,
  getCompletedTasks,
  getCompletedTaskCount,
} from "./db";
import { getRequestOrgId } from "./org";
import { routeWebhook } from "./hub/router";
import { verifyLinearSignature } from "./signature";
import { requireAuth as checkAuth, getAuthInfo, isClerkEnabled } from "./auth";
import type { ClaudeOrchestrator, AgentDeathInfo, AgentCompletionInfo } from "./orchestrator";
import { buildPrompt, buildCommentPrompt, buildRecoveryPrompt } from "./prompt";
import { isBotComment } from "./comment-filter";
import type { AgentPersistence } from "./persistence";
import type { HealthMonitor } from "./health-monitor";
import type { MachineRegistry } from "./hub/registry";
import type { RouterHeartbeat } from "./router-heartbeat";
import type { HubHeartbeat } from "./hub-heartbeat";
import type { IdleScanner } from "./hub/idle-scanner";
import type { LinearWebhookPayload, LinearIssue, LinearComment, AgentStatus } from "./types";
import { checkPRMerged, deleteBranch } from "./github";
import {
  shouldNotify,
  notifyFeedbackNeeded,
  notifyReviewReady,
} from "./notifications";
import {
  notifyFeedbackNeededTelegram,
  notifyReviewReadyTelegram,
  parseIssueFromMessage,
} from "./telegram";
import { fetchIssueDetails, fetchTeamWorkflowStates } from "./linear";
import { getSystemResources } from "./machine/resources";

export interface ServerContext {
  orchestrator: ClaudeOrchestrator | null;
  machineRegistry: MachineRegistry | null;
  healthMonitor: HealthMonitor | null;
  persistence: AgentPersistence | null;
  hubHeartbeat: HubHeartbeat | null;
  routerHeartbeat: RouterHeartbeat | null;
  idleScanner: IdleScanner | null;
}

export function createFetchHandler(ctx: ServerContext): (req: Request) => Promise<Response> {
  const machineConfig = getMachineConfig();
  const routerConfig = getRouterConfig();

  function isComment(data: LinearIssue | LinearComment): data is LinearComment {
    return "body" in data && "issueId" in data;
  }

  function isDraft(issue: LinearIssue): boolean {
    const stateType = issue.state?.type?.toLowerCase();
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    return stateType === "triage" || stateName.includes("draft");
  }

  function shouldTerminateAgent(issue: LinearIssue): boolean {
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    const stateType = issue.state?.type?.toLowerCase() ?? "";

    return (
      stateType === "completed" ||
      stateType === "canceled" ||
      stateType === "backlog" ||
      stateName.includes("done") ||
      stateName.includes("backlog") ||
      stateName.includes("canceled") ||
      stateName.includes("cancelled") ||
      stateName.includes("todo")
    );
  }

  type CompletionReason = "done" | "stopped" | "canceled" | "backlog";

  function getCompletionReason(issue: LinearIssue): CompletionReason {
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    const stateType = issue.state?.type?.toLowerCase() ?? "";

    if (stateType === "completed" || stateName.includes("done")) {
      return "done";
    }
    if (stateType === "canceled" || stateName.includes("cancel")) {
      return "canceled";
    }
    if (stateType === "backlog" || stateName.includes("backlog") || stateName.includes("todo")) {
      return "backlog";
    }
    return "stopped";
  }

  async function sendStateNotification(
    previousState: string | undefined,
    newState: string,
    issue: LinearIssue
  ): Promise<void> {
    if (!shouldNotify(previousState, newState)) {
      return;
    }

    const issueUrl = `https://linear.app/${CONFIG.linearWorkspace}/issue/${issue.identifier}`;

    if (CONFIG.notificationEmail && CONFIG.resendApiKey) {
      const emailOptions = {
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        to: CONFIG.notificationEmail,
        apiKey: CONFIG.resendApiKey,
        from: CONFIG.notificationFromEmail,
      };

      let emailResult;
      if (newState === "Feedback Needed") {
        emailResult = await notifyFeedbackNeeded(emailOptions);
      } else if (newState === "Review") {
        emailResult = await notifyReviewReady(emailOptions);
      }

      if (emailResult?.success) {
        console.log(
          `[Notification] Sent email ${newState} notification for ${issue.identifier}`
        );
      } else if (emailResult?.error) {
        console.warn(
          `[Notification] Failed to send email for ${issue.identifier}: ${emailResult.error}`
        );
      }
    }

    if (CONFIG.telegramBotToken && CONFIG.telegramChatId) {
      const telegramOptions = {
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        issueUrl,
        chatId: CONFIG.telegramChatId,
        botToken: CONFIG.telegramBotToken,
      };

      let telegramResult;
      if (newState === "Feedback Needed") {
        telegramResult = await notifyFeedbackNeededTelegram(telegramOptions);
      } else if (newState === "Review") {
        telegramResult = await notifyReviewReadyTelegram(telegramOptions);
      }

      if (telegramResult?.success) {
        console.log(
          `[Notification] Sent Telegram ${newState} notification for ${issue.identifier}`
        );
      } else if (telegramResult?.error) {
        console.warn(
          `[Notification] Failed to send Telegram for ${issue.identifier}: ${telegramResult.error}`
        );
      }
    }
  }

  async function handleIssueWebhook(
    action: string,
    issue: LinearIssue
  ): Promise<void> {
    if (!ctx.orchestrator || !ctx.healthMonitor) {
      console.error("[Webhook] Machine components not initialized");
      return;
    }

    if (isDraft(issue)) {
      console.log(
        `[${new Date().toISOString()}] Skipping draft issue: ${issue.identifier}`
      );
      return;
    }

    const agentKey = ctx.orchestrator.getAgentKey(issue);

    console.log(
      `[${new Date().toISOString()}] Issue ${action}: ${issue.identifier} - ${issue.title}`
    );

    if (action === "remove") {
      await ctx.orchestrator.stopAgent(agentKey, "canceled");
      ctx.healthMonitor.notifyAgentCountChanged();
      ctx.hubHeartbeat?.notifyAgentChange();
      return;
    }

    if (shouldTerminateAgent(issue)) {
      const existingKey = ctx.orchestrator.findAgentByIssueId(issue.id);
      if (existingKey) {
        if (issue.state?.name) {
          ctx.orchestrator.updateIssueState(existingKey, issue.state.name);
        }
        const reason = getCompletionReason(issue);
        console.log(
          `[${new Date().toISOString()}] Terminating agent for ${issue.identifier} - moved to ${issue.state?.name} (${reason})`
        );
        await ctx.orchestrator.stopAgent(existingKey, reason);
        ctx.healthMonitor.notifyAgentCountChanged();
        ctx.hubHeartbeat?.notifyAgentChange();
      }
      return;
    }

    if (ctx.orchestrator.hasAgent(agentKey) && issue.state?.name) {
      const previousState = ctx.orchestrator.getAgentState(agentKey);
      ctx.orchestrator.updateIssueState(agentKey, issue.state.name);

      sendStateNotification(previousState, issue.state.name, issue).catch(
        (err) => console.error("[Notification] Error:", err)
      );
    }

    if (ctx.orchestrator.shouldStartAgent(issue)) {
      if (ctx.orchestrator.hasAgent(agentKey)) {
        let workflowStates;
        const realmInfo = issue.team?.key ? getRealmByTeamKey(issue.team.key) : undefined;
        if (realmInfo?.apiKey && issue.team?.key) {
          workflowStates = await fetchTeamWorkflowStates(issue.team.key, realmInfo.apiKey);
        }
        await ctx.orchestrator.sendMessage(
          agentKey,
          buildPrompt(issue, undefined, CONFIG.linearWorkspace, CONFIG.agentName, undefined, undefined, workflowStates)
        );
      } else {
        await ctx.orchestrator.startAgent(issue);
        ctx.healthMonitor.notifyAgentCountChanged();
        ctx.hubHeartbeat?.notifyAgentChange();
      }
    }
  }

  async function handleCommentWebhook(
    action: string,
    comment: LinearComment
  ): Promise<void> {
    if (!ctx.orchestrator || !ctx.healthMonitor || !ctx.persistence) {
      console.error("[Webhook] Machine components not initialized");
      return;
    }

    if (action !== "create") return;

    if (isDraft(comment.issue)) {
      console.log(
        `[${new Date().toISOString()}] Skipping comment on draft issue: ${comment.issue.identifier}`
      );
      return;
    }

    if (isBotComment(comment, CONFIG.claudeBotUserId, CONFIG.agentName)) {
      console.log(
        `[${new Date().toISOString()}] Skipping bot comment on ${comment.issue.identifier}`
      );
      return;
    }

    console.log(
      `[${new Date().toISOString()}] Comment ${action}: ${comment.issue.identifier} from ${comment.user?.name ?? "unknown"}`
    );

    let agentKey = ctx.orchestrator.findAgentByIssueId(comment.issueId);

    if (!agentKey) {
      const teamKey = comment.issue.identifier.split("-")[0];
      const realmInfo = getRealmByTeamKey(teamKey);
      let issue = comment.issue;

      if (realmInfo?.apiKey && (!issue.state?.name || !issue.labels?.length)) {
        const fullIssue = await fetchIssueDetails(comment.issueId, realmInfo.apiKey);
        if (fullIssue) {
          issue = fullIssue;
          console.log(
            `[${new Date().toISOString()}] Fetched full issue details for ${issue.identifier} (state: ${issue.state?.name}, labels: ${issue.labels?.map(l => l.name).join(", ")})`
          );
        }
      }

      const shouldSpawn = ctx.orchestrator.shouldStartAgent(issue) || ctx.orchestrator.isAwaitingFeedback(issue);
      if (!shouldSpawn) {
        console.log(
          `[${new Date().toISOString()}] Ignoring comment on ${issue.identifier} - does not meet trigger criteria (state: ${issue.state?.name}, labels: ${issue.labels?.map(l => l.name).join(", ") ?? "none"})`
        );
        return;
      }

      if (ctx.orchestrator.isAwaitingFeedback(issue)) {
        console.log(
          `[${new Date().toISOString()}] Spawning agent for ${issue.identifier} - feedback response received`
        );
      }

      comment.issue = issue;

      const savedState = ctx.persistence.getAgentByIssueId(comment.issueId);

      if (savedState?.status === "dead") {
        console.log(
          `[${new Date().toISOString()}] Recovering agent for ${comment.issue.identifier} from saved state`
        );

        await ctx.orchestrator.startAgent(comment.issue);
        ctx.healthMonitor.notifyAgentCountChanged();
        ctx.hubHeartbeat?.notifyAgentChange();
        agentKey = ctx.orchestrator.findAgentByIssueId(comment.issueId);

        if (!agentKey) {
          console.error(
            `[${new Date().toISOString()}] Failed to spawn recovery agent for ${comment.issue.identifier}`
          );
          return;
        }

        let workflowStates;
        if (realmInfo?.apiKey && issue.team?.key) {
          workflowStates = await fetchTeamWorkflowStates(issue.team.key, realmInfo.apiKey);
        }

        const recoveryPrompt = buildRecoveryPrompt(comment.issue, savedState, undefined, CONFIG.agentName, workflowStates);
        await ctx.orchestrator.sendMessage(agentKey, recoveryPrompt);

        ctx.persistence.markAgentAlive(comment.issueId);
      } else {
        console.log(
          `[${new Date().toISOString()}] No active agent for ${comment.issue.identifier} - spawning new agent`
        );
        await ctx.orchestrator.startAgent(comment.issue);
        ctx.healthMonitor.notifyAgentCountChanged();
        ctx.hubHeartbeat?.notifyAgentChange();
        agentKey = ctx.orchestrator.findAgentByIssueId(comment.issueId);

        if (!agentKey) {
          console.error(
            `[${new Date().toISOString()}] Failed to spawn agent for ${comment.issue.identifier}`
          );
          return;
        }
      }
    }

    await ctx.orchestrator.sendMessage(agentKey, buildCommentPrompt(comment));
  }

  async function forwardWebhookToMachine(
    machineUrl: string,
    payload: string,
    signature: string | null,
    teamKey: string
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (signature) {
        headers["linear-signature"] = signature;
      }

      const currentRouterConfig = getRouterConfig();
      if (currentRouterConfig) {
        headers["X-Amadeus-Secret"] = currentRouterConfig.secret;
      }

      const response = await fetch(`${machineUrl}/webhook`, {
        method: "POST",
        headers,
        body: payload,
      });

      if (!response.ok) {
        console.warn(
          `[WebhookForward] Failed to forward webhook to ${machineUrl} for ${teamKey}: HTTP ${response.status}`
        );
      } else {
        console.log(
          `[WebhookForward] Forwarded webhook to ${machineUrl} for ${teamKey}`
        );
      }
    } catch (err) {
      console.warn(
        `[WebhookForward] Error forwarding webhook to ${machineUrl} for ${teamKey}: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  function getTeamKeyFromPayload(payload: LinearWebhookPayload): string | null {
    const { type, data } = payload;

    if (type === "Issue" && !isComment(data)) {
      return data.identifier?.split("-")[0] ?? null;
    } else if (type === "Comment" && isComment(data)) {
      return data.issue?.identifier?.split("-")[0] ?? null;
    }

    return null;
  }

  function getProjectNameFromPayload(payload: LinearWebhookPayload): string | null {
    const { type, data } = payload;

    if (type === "Issue" && !isComment(data)) {
      return data.project?.name ?? null;
    } else if (type === "Comment" && isComment(data)) {
      return data.issue?.project?.name ?? null;
    }

    return null;
  }

  async function handleWebhook(payload: LinearWebhookPayload): Promise<void> {
    const { action, type, data } = payload;

    if (type === "Issue" && !isComment(data)) {
      await handleIssueWebhook(action, data);
    } else if (type === "Comment" && isComment(data)) {
      await handleCommentWebhook(action, data);
    }
  }

  async function requireViewer(req: Request): Promise<Response | null> {
    const security = getSecurityConfig();
    if (security.publicDashboard) {
      return null;
    }
    const result = await checkAuth(req, "viewer", {
      apiToken: CONFIG.apiToken,
      enableAgentMessaging: security.enableAgentMessaging,
    });
    return result.authorized ? null : result.response;
  }

  async function requireOperator(req: Request): Promise<Response | null> {
    const security = getSecurityConfig();
    const result = await checkAuth(req, "operator", {
      apiToken: CONFIG.apiToken,
      enableAgentMessaging: security.enableAgentMessaging,
    });
    return result.authorized ? null : result.response;
  }

  async function requireAdmin(req: Request): Promise<Response | null> {
    const security = getSecurityConfig();
    const result = await checkAuth(req, "admin", {
      apiToken: CONFIG.apiToken,
      enableAgentMessaging: security.enableAgentMessaging,
    });
    return result.authorized ? null : result.response;
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response("OK");
    }

    // Redirect root to dashboard
    if (req.method === "GET" && url.pathname === "/") {
      return Response.redirect(new URL("/dashboard", req.url).toString(), 302);
    }

    // Linear webhook endpoint
    if (req.method === "POST" && (url.pathname === "/webhook" || url.pathname.startsWith("/webhook/"))) {
      const orgId = getRequestOrgId(url);
      const payload = await req.text();
      const signature = req.headers.get("linear-signature");

      let verifiedRealm: string | null = null;
      const machineApiKey = process.env.AMADEUS_API_KEY;
      const hubSecret = req.headers.get("X-Amadeus-Secret");

      if (machineApiKey && hubSecret) {
        if (hubSecret !== machineApiKey) {
          console.warn("[Webhook] Invalid hub secret");
          return new Response("Unauthorized", { status: 401 });
        }
      } else if (routerConfig) {
        if (hubSecret !== routerConfig.secret) {
          console.warn("[Webhook] Invalid router secret");
          return new Response("Unauthorized", { status: 401 });
        }
      } else {
        const secrets = getAllWebhookSecrets();
        let verified = false;

        for (const { secret, realmName } of secrets) {
          if (await verifyLinearSignature(payload, signature, secret)) {
            verified = true;
            verifiedRealm = realmName;
            break;
          }
        }

        if (!verified) {
          console.warn("[Webhook] Invalid signature - no matching realm secret");
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const data = JSON.parse(payload) as LinearWebhookPayload;

      const MAX_AGE_MS = 60000;
      const now = Date.now();
      const webhookTimestamp = data.webhookTimestamp;

      if (!webhookTimestamp || Math.abs(now - webhookTimestamp) > MAX_AGE_MS) {
        console.warn(`[Webhook] Timestamp validation failed: ${webhookTimestamp}`);
        return new Response("Unauthorized", { status: 401 });
      }

      if (isHubMode()) {
        const route = routeWebhook(data);
        if (route.machineUrl) {
          forwardWebhookToMachine(route.machineUrl, payload, signature, route.machineName ?? "unknown").catch((err) => {
            console.error("[HubForward] Error:", err);
          });
          return new Response("OK", { status: 200 });
        }
        console.warn(`[Webhook] Hub mode but no machine routing configured: ${route.reason}`);
        return new Response("No machine configured for this webhook", { status: 422 });
      }

      if (!ctx.orchestrator) {
        return new Response("Machine components not initialized", { status: 500 });
      }

      const teamKey = getTeamKeyFromPayload(data);
      const projectName = getProjectNameFromPayload(data);
      const machineUrl = getMachineUrlForProject(projectName ?? undefined, teamKey ?? undefined);
      if (machineUrl) {
        const identifier = projectName ?? teamKey ?? "unknown";
        forwardWebhookToMachine(machineUrl, payload, signature, identifier).catch((err) => {
          console.error("[WebhookForward] Error:", err);
        });
        return new Response("OK", { status: 200 });
      }

      handleWebhook(data).catch((err) => {
        console.error("[Webhook] Error handling webhook:", err);
      });

      return new Response("OK", { status: 200 });
    }

    // Auth info endpoint
    if (req.method === "GET" && url.pathname === "/auth/info") {
      return Response.json(getAuthInfo());
    }

    // Status dashboard (JSON)
    if (req.method === "GET" && url.pathname === "/status") {
      const authError = await requireViewer(req);
      if (authError) return authError;

      const agents = ctx.orchestrator ? await ctx.orchestrator.getStatusWithMemory() : [];
      return Response.json({
        agents,
        timestamp: new Date().toISOString(),
        mode: getRuntimeMode(),
      });
    }

    // Hub status endpoint
    if (req.method === "GET" && url.pathname === "/hub/status") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const authError = await requireViewer(req);
      if (authError) return authError;

      const machineStatuses = ctx.machineRegistry?.getCachedStatus() ?? [];

      let localStatus = null;
      if (isStandaloneMode() && ctx.orchestrator) {
        const agents = await ctx.orchestrator.getStatusWithMemory();
        localStatus = {
          name: machineConfig.name,
          url: "",
          status: "healthy" as const,
          agents,
          agentCount: agents.length,
        };
      }

      return Response.json({
        machines: localStatus ? [localStatus, ...machineStatuses] : machineStatuses,
        timestamp: new Date().toISOString(),
      });
    }

    // Receive status heartbeat from machines (push-based)
    if (req.method === "POST" && url.pathname === "/hub/heartbeat") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      const body = await req.json();
      const { machineName, machineUrl: heartbeatMachineUrl, agents } = body as {
        machineName: string;
        machineUrl?: string;
        agents?: AgentStatus[];
      };

      if (!machineName) {
        return new Response("Missing machineName", { status: 400 });
      }

      // Dynamic import to avoid circular dependency at module load time
      const { updateMachineLastSeen, authenticateMachine } = await import("./db");

      let machine = ctx.machineRegistry?.get(machineName);
      if (!machine) {
        if (token) {
          const hasher = new Bun.CryptoHasher("sha256");
          hasher.update(token);
          const hash = hasher.digest("hex");
          const dbAuth = await authenticateMachine(hash);
          if (dbAuth && dbAuth.machineName === machineName) {
            ctx.machineRegistry?.register(machineName, heartbeatMachineUrl ?? "", token);
            machine = ctx.machineRegistry?.get(machineName);
            await updateMachineLastSeen(dbAuth.machineId);
          }
        }
        if (!machine) {
          return new Response("Unknown machine", { status: 403 });
        }
      } else if (machine.apiKey && machine.apiKey !== token) {
        return new Response("Invalid token", { status: 403 });
      }

      ctx.machineRegistry?.updateStatus(machineName, "healthy", agents ?? []);

      console.log(`[Hub] Heartbeat from ${machineName}: ${agents?.length ?? 0} agents`);

      return new Response("OK", { status: 200 });
    }

    // Hub proxy for remote machine agent messages
    if (req.method === "POST" && url.pathname === "/hub/proxy/messages") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const body = await req.json();
      const { machineUrl: proxyMachineUrl, taskKey } = body as { machineUrl: string; taskKey: string };

      if (!proxyMachineUrl || !taskKey) {
        return new Response("Missing machineUrl or taskKey", { status: 400 });
      }

      const machine = ctx.machineRegistry?.getAll().find(m => m.url === proxyMachineUrl);
      const headers: Record<string, string> = {};
      if (machine?.apiKey) {
        headers["Authorization"] = `Bearer ${machine.apiKey}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${proxyMachineUrl}/agents/${encodeURIComponent(taskKey)}/messages`, {
          signal: controller.signal,
          headers,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return new Response(await res.text(), { status: res.status });
        }
        return Response.json(await res.json());
      } catch (err) {
        console.error("[Hub] Proxy messages error:", err);
        return new Response("Failed to fetch messages from remote machine", { status: 502 });
      }
    }

    // Hub proxy for remote machine agent stop
    if (req.method === "POST" && url.pathname === "/hub/proxy/stop") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const body = await req.json();
      const { machineUrl: proxyMachineUrl, taskKey } = body as { machineUrl: string; taskKey: string };

      if (!proxyMachineUrl || !taskKey) {
        return new Response("Missing machineUrl or taskKey", { status: 400 });
      }

      const machine = ctx.machineRegistry?.getAll().find(m => m.url === proxyMachineUrl);
      const headers: Record<string, string> = {};
      if (machine?.apiKey) {
        headers["Authorization"] = `Bearer ${machine.apiKey}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${proxyMachineUrl}/agents/${encodeURIComponent(taskKey)}/stop`, {
          method: "POST",
          signal: controller.signal,
          headers,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return new Response(await res.text(), { status: res.status });
        }
        return Response.json(await res.json());
      } catch (err) {
        console.error("[Hub] Proxy stop error:", err);
        return new Response("Failed to stop agent on remote machine", { status: 502 });
      }
    }

    // Hub proxy for remote machine trigger
    if (req.method === "POST" && url.pathname === "/hub/proxy/trigger") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const body = await req.json();
      const { machineUrl: proxyMachineUrl, agentKey, message } = body as { machineUrl: string; agentKey: string; message: string };

      if (!proxyMachineUrl || !agentKey) {
        return new Response("Missing machineUrl or agentKey", { status: 400 });
      }

      const machine = ctx.machineRegistry?.getAll().find(m => m.url === proxyMachineUrl);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (machine?.apiKey) {
        headers["Authorization"] = `Bearer ${machine.apiKey}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${proxyMachineUrl}/trigger`, {
          method: "POST",
          signal: controller.signal,
          headers,
          body: JSON.stringify({ agentKey, message }),
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return new Response(await res.text(), { status: res.status });
        }
        const text = await res.text();
        return new Response(text, { status: res.status });
      } catch (err) {
        console.error("[Hub] Proxy trigger error:", err);
        return new Response("Failed to trigger agent on remote machine", { status: 502 });
      }
    }

    // Completed tasks history (from Postgres)
    if (req.method === "GET" && url.pathname === "/status/history") {
      const authError = await requireViewer(req);
      if (authError) return authError;

      const orgId = getRequestOrgId(url);
      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      const completedTasksList = await getCompletedTasks(orgId, limit, offset);
      const total = await getCompletedTaskCount(orgId);

      return Response.json({
        completedTasks: completedTasksList.map((task) => ({
          ...task,
          completedAt: task.completedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    }

    // Dashboard config (read)
    if (req.method === "GET" && url.pathname === "/config") {
      const authError = await requireViewer(req);
      if (authError) return authError;

      const setup = REALM_CONFIG
        ? {
            realms: REALM_CONFIG.realms.map((realm) => ({
              name: realm.name,
              linearWorkspace: realm.linearWorkspace,
              projects: realm.projects.map((project) => ({
                teamKey: project.teamKey,
                linearProject: project.linearProject,
                path: project.path,
                profile: project.profile,
                githubRepoUrl: project.githubRepoUrl,
              })),
            })),
            global: {
              agentName: REALM_CONFIG.global.agentName,
              port: REALM_CONFIG.global.port,
              triggerStates: REALM_CONFIG.global.triggerStates,
              useWorktrees: REALM_CONFIG.global.useWorktrees,
              defaultProfile: REALM_CONFIG.global.defaultProfile,
              security: REALM_CONFIG.global.security,
            },
          }
        : null;

      return Response.json({
        linearWorkspace: CONFIG.linearWorkspace,
        machineName: machineConfig.name,
        runtimeMode: getRuntimeMode(),
        setup,
      });
    }

    // Config YAML (read raw)
    if (req.method === "GET" && url.pathname === "/config/yaml") {
      const authError = await requireViewer(req);
      if (authError) return authError;

      const orgId = getRequestOrgId(url);
      const yaml = await getConfigYaml(orgId);
      if (!yaml) {
        return new Response("No config file found", { status: 404 });
      }

      return new Response(yaml, {
        headers: { "Content-Type": "text/yaml" },
      });
    }

    // Config YAML (validate without saving)
    if (req.method === "POST" && url.pathname === "/config/validate") {
      const authError = await requireAdmin(req);
      if (authError) return authError;

      const yamlContent = await req.text();
      const result = validateConfigYaml(yamlContent);

      if (result.valid) {
        return Response.json({ valid: true });
      }
      return Response.json({ valid: false, errors: result.errors }, { status: 400 });
    }

    // Config YAML (save and reload)
    if (req.method === "POST" && url.pathname === "/config") {
      const authError = await requireAdmin(req);
      if (authError) return authError;

      const orgId = getRequestOrgId(url);
      const yamlContent = await req.text();
      const result = reloadConfig(yamlContent, orgId);

      if (result.success) {
        return Response.json({ success: true });
      }
      return Response.json({ success: false, errors: result.errors }, { status: 400 });
    }

    // Manual trigger endpoint
    if (req.method === "POST" && url.pathname === "/trigger") {
      const authError = await requireOperator(req);
      if (authError) return authError;

      if (!ctx.orchestrator) {
        return new Response("Machine components not initialized", { status: 500 });
      }

      try {
        const { agentKey, message } = await req.json();
        if (!agentKey || !message) {
          return new Response("Bad Request: agentKey and message required", { status: 400 });
        }
        await ctx.orchestrator.sendMessage(agentKey, message);
        return new Response("Sent");
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
    }

    // Telegram webhook endpoint
    if (req.method === "POST" && url.pathname === "/telegram-webhook") {
      try {
        const update = await req.json();

        const messageText = update?.message?.text;
        if (!messageText) {
          return new Response("OK");
        }

        const parsed = parseIssueFromMessage(messageText);
        if (!parsed) {
          console.log(
            `[Telegram] Received message without valid issue format: ${messageText.slice(0, 50)}...`
          );
          return new Response("OK");
        }

        console.log(
          `[Telegram] Received reply for ${parsed.issueIdentifier}: ${parsed.message.slice(0, 50)}...`
        );

        const teamKey = parsed.issueIdentifier.split("-")[0];
        const realmInfo = getRealmByTeamKey(teamKey);
        const env = realmInfo?.apiKey
          ? { ...process.env, LINEAR_API_KEY: realmInfo.apiKey }
          : process.env;

        await $`linear-cli comments create --body ${parsed.message} ${parsed.issueIdentifier}`
          .env(env)
          .quiet();

        console.log(
          `[Telegram] Posted comment to ${parsed.issueIdentifier}`
        );

        return new Response("OK");
      } catch (err) {
        console.error("[Telegram] Error processing webhook:", err);
        return new Response("OK");
      }
    }

    // Agent messages proxy endpoint
    const messagesMatch = url.pathname.match(/^\/agents\/([^/]+)\/messages$/);
    if (req.method === "GET" && messagesMatch) {
      const authError = await requireViewer(req);
      if (authError) return authError;

      if (!ctx.orchestrator) {
        return new Response("Machine components not initialized", { status: 500 });
      }

      const agentKey = decodeURIComponent(messagesMatch[1]);
      const agent = ctx.orchestrator.getStatus().find((a) => a.key === agentKey);

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

    // Stop agent endpoint
    const stopMatch = url.pathname.match(/^\/agents\/([^/]+)\/stop$/);
    if (req.method === "POST" && stopMatch) {
      const authError = await requireOperator(req);
      if (authError) return authError;

      if (!ctx.orchestrator || !ctx.healthMonitor) {
        return new Response("Machine components not initialized", { status: 500 });
      }

      const agentKey = decodeURIComponent(stopMatch[1]);
      console.log(`[${new Date().toISOString()}] Manual stop requested for agent: ${agentKey}`);
      await ctx.orchestrator.stopAgent(agentKey, "stopped");
      ctx.healthMonitor.notifyAgentCountChanged();
      ctx.hubHeartbeat?.notifyAgentChange();
      return Response.json({ success: true });
    }

    // Machine resource monitoring endpoint
    if (req.method === "GET" && url.pathname === "/machine/resources") {
      if (isHubMode()) {
        return new Response("Not available in hub mode", { status: 404 });
      }

      const authError = await requireViewer(req);
      if (authError) return authError;

      const resources = await getSystemResources();
      return Response.json(resources);
    }

    return new Response("Not Found", { status: 404 });
  };
}

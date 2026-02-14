// ABOUTME: Factory for the HTTP fetch handler, decoupled from server startup.
// ABOUTME: Enables amadeus-cloud to wrap the handler with org resolution.


import { $ } from "bun";
import {
  CONFIG,
  REALM_CONFIG,
  getAllWebhookSecrets,
  getOrgWebhookSecrets,
  getOrgConfig,
  invalidateOrgConfig,
  resolveLinearApiKey,
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
import { getWebhookOrgId, DEFAULT_ORG_ID } from "./org";
import { routeWebhook, getAssigneeIdFromPayload } from "./hub/router";
import { verifyLinearSignature } from "./signature";
import { requireAuth as checkAuth, getAuthInfo, isBetterAuthEnabled } from "./auth";
import { auth } from "./better-auth";
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
  /** Optional org resolver provided by cloud layer. Falls back to DEFAULT_ORG_ID. */
  resolveOrgId?: (req: Request) => Promise<string>;
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
    issue: LinearIssue,
    orgId: string,
    repoPathOverride?: string,
    routingApiKey?: string
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
      const teamKey = issue.identifier.split("-")[0];
      const apiKey = routingApiKey ?? await resolveLinearApiKey(orgId, teamKey, issue.assignee?.id);

      if (ctx.orchestrator.hasAgent(agentKey)) {
        let workflowStates;
        if (apiKey && issue.team?.key) {
          workflowStates = await fetchTeamWorkflowStates(issue.team.key, apiKey);
        }
        await ctx.orchestrator.sendMessage(
          agentKey,
          buildPrompt(issue, undefined, CONFIG.linearWorkspace, CONFIG.agentName, undefined, undefined, workflowStates)
        );
      } else {
        await ctx.orchestrator.startAgent(issue, repoPathOverride, apiKey ?? undefined, orgId);
        ctx.healthMonitor.notifyAgentCountChanged();
        ctx.hubHeartbeat?.notifyAgentChange();
      }
    }
  }

  async function handleCommentWebhook(
    action: string,
    comment: LinearComment,
    orgId: string,
    repoPathOverride?: string,
    routingApiKey?: string
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
      const apiKey = routingApiKey ?? await resolveLinearApiKey(orgId, teamKey, comment.issue.assignee?.id);
      let issue = comment.issue;

      if (apiKey && (!issue.state?.name || !issue.labels?.length)) {
        const fullIssue = await fetchIssueDetails(comment.issueId, apiKey);
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

        await ctx.orchestrator.startAgent(comment.issue, repoPathOverride, apiKey ?? undefined, orgId);
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
        if (apiKey && issue.team?.key) {
          workflowStates = await fetchTeamWorkflowStates(issue.team.key, apiKey);
        }

        const recoveryPrompt = buildRecoveryPrompt(comment.issue, savedState, undefined, CONFIG.agentName, workflowStates);
        await ctx.orchestrator.sendMessage(agentKey, recoveryPrompt);

        ctx.persistence.markAgentAlive(comment.issueId);
      } else {
        console.log(
          `[${new Date().toISOString()}] No active agent for ${comment.issue.identifier} - spawning new agent`
        );
        await ctx.orchestrator.startAgent(comment.issue, repoPathOverride, apiKey ?? undefined, orgId);
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
    teamKey: string,
    localRepoPath?: string | null,
    machineApiKey?: string | null,
    linearApiKey?: string | null
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (signature) {
        headers["linear-signature"] = signature;
      }

      if (machineApiKey) {
        headers["X-Amadeus-Secret"] = machineApiKey;
      } else {
        const currentRouterConfig = getRouterConfig();
        if (currentRouterConfig) {
          headers["X-Amadeus-Secret"] = currentRouterConfig.secret;
        }
      }

      let forwardPayload = payload;
      if (localRepoPath || linearApiKey) {
        const parsed = JSON.parse(payload);
        parsed._routing = {
          ...(localRepoPath && { localRepoPath }),
          ...(linearApiKey && { linearApiKey }),
        };
        forwardPayload = JSON.stringify(parsed);
      }

      let response: Response;
      try {
        response = await fetch(`${machineUrl}/webhook`, {
          method: "POST",
          headers,
          body: forwardPayload,
          // @ts-ignore - Bun-specific TLS option
          tls: { rejectUnauthorized: false },
        });
      } catch (tlsErr) {
        // Fallback: use curl for TLS-problematic connections (e.g. Tailscale funnel certs)
        console.log(`[WebhookForward] fetch failed with TLS error, retrying with curl: ${(tlsErr as Error).message}`);
        const curlArgs = ["-skv", "-X", "POST", "-w", "\n%{http_code}"];
        for (const [k, v] of Object.entries(headers)) {
          curlArgs.push("-H", `${k}: ${v}`);
        }
        curlArgs.push("-d", forwardPayload, `${machineUrl}/webhook`);
        console.log(`[WebhookForward] curl args: curl ${curlArgs.map(a => a.length > 100 ? a.slice(0, 100) + '...' : a).join(' ')}`);
        const proc = Bun.spawn(["curl", ...curlArgs], { stdout: "pipe", stderr: "pipe" });
        const [output, errOutput, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        console.log(`[WebhookForward] curl exit=${exitCode} stdout=${output.trim().slice(-20)} stderr=${errOutput.trim().slice(-200)}`);
        const lines = output.trim().split("\n");
        const statusCode = parseInt(lines[lines.length - 1], 10) || 500;
        response = new Response(null, { status: statusCode });
      }

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

  async function handleWebhook(payload: LinearWebhookPayload, orgId: string, repoPathOverride?: string, routingApiKey?: string): Promise<void> {
    const { action, type, data } = payload;

    if (type === "Issue" && !isComment(data)) {
      await handleIssueWebhook(action, data, orgId, repoPathOverride, routingApiKey);
    } else if (type === "Comment" && isComment(data)) {
      await handleCommentWebhook(action, data, orgId, repoPathOverride, routingApiKey);
    }
  }

  async function requireViewer(req: Request, orgId: string = DEFAULT_ORG_ID): Promise<Response | null> {
    const security = getSecurityConfig();
    if (security.publicDashboard) {
      return null;
    }
    const result = await checkAuth(req, "viewer", {
      apiToken: CONFIG.apiToken,
      enableAgentMessaging: security.enableAgentMessaging,
      orgId,
    });
    return result.authorized ? null : result.response;
  }

  async function requireOperator(req: Request, orgId: string = DEFAULT_ORG_ID): Promise<Response | null> {
    const security = getSecurityConfig();
    if (security.enableAgentMessaging) {
      return null;
    }
    const result = await checkAuth(req, "operator", {
      apiToken: CONFIG.apiToken,
      enableAgentMessaging: security.enableAgentMessaging,
      orgId,
    });
    return result.authorized ? null : result.response;
  }

  async function requireAdmin(req: Request, orgId: string = DEFAULT_ORG_ID): Promise<Response | null> {
    const security = getSecurityConfig();
    const result = await checkAuth(req, "admin", {
      apiToken: CONFIG.apiToken,
      enableAgentMessaging: security.enableAgentMessaging,
      orgId,
    });
    return result.authorized ? null : result.response;
  }

  /** Resolve orgId for non-webhook requests (API, dashboard, etc.) */
  async function resolveApiOrgId(req: Request): Promise<string> {
    if (ctx.resolveOrgId) {
      return ctx.resolveOrgId(req);
    }
    return DEFAULT_ORG_ID;
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Better Auth handler (session management, sign-in, sign-up, OAuth callbacks)
    if (auth && url.pathname.startsWith("/api/auth/")) {
      return auth.handler(req);
    }

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
      console.log(`[Webhook] Received POST ${url.pathname} from ${req.headers.get("user-agent") ?? "unknown"}`);
      const orgId = getWebhookOrgId(url);
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
        const secrets = await getOrgWebhookSecrets(orgId);
        let verified = false;

        for (const { secret, realmName } of secrets) {
          if (await verifyLinearSignature(payload, signature, secret)) {
            verified = true;
            verifiedRealm = realmName;
            break;
          }
        }

        if (!verified) {
          console.warn(`[Webhook] Invalid signature - no matching realm secret for org ${orgId}`);
          return new Response("Unauthorized", { status: 401 });
        }
      }

      const data = JSON.parse(payload) as LinearWebhookPayload;
      const routing = (data as any)._routing as { localRepoPath?: string; linearApiKey?: string } | undefined;

      const MAX_AGE_MS = 60000;
      const now = Date.now();
      const webhookTimestamp = data.webhookTimestamp;

      if (!webhookTimestamp || Math.abs(now - webhookTimestamp) > MAX_AGE_MS) {
        console.warn(`[Webhook] Timestamp validation failed: ${webhookTimestamp}`);
        return new Response("Unauthorized", { status: 401 });
      }

      if (isHubMode()) {
        const teamKey = getTeamKeyFromPayload(data);
        const projectName = getProjectNameFromPayload(data);
        const assigneeLinearId = getAssigneeIdFromPayload(data);
        console.log(`[Webhook] type=${data.type} action=${data.action} teamKey=${teamKey} projectName=${projectName}`);
        const route = await routeWebhook(orgId, data);
        if (route.machineUrl) {
          let machineKey: string | null = null;
          if (route.machineId) {
            const { getSecret: getMachineSecret } = await import("./db");
            machineKey = await getMachineSecret(orgId, `machine:${route.machineId}:api_key`);
          }
          // Resolve Linear API key so machine doesn't need its own
          const linearApiKey = teamKey
            ? await resolveLinearApiKey(orgId, teamKey, assigneeLinearId ?? undefined)
            : null;
          console.log(`[HubForward] Routing to ${route.machineName} (id=${route.machineId}), hasApiKey=${!!machineKey}, hasLinearKey=${!!linearApiKey}`);
          forwardWebhookToMachine(route.machineUrl, payload, signature, route.machineName ?? "unknown", route.localRepoPath, machineKey, linearApiKey).catch((err) => {
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

      handleWebhook(data, orgId, routing?.localRepoPath, routing?.linearApiKey).catch((err) => {
        console.error("[Webhook] Error handling webhook:", err);
      });

      return new Response("OK", { status: 200 });
    }

    // Auth info endpoint
    if (req.method === "GET" && url.pathname === "/auth/info") {
      return Response.json(getAuthInfo());
    }

    // Current user endpoint (returns hub user info + role for authenticated sessions)
    if (req.method === "GET" && url.pathname === "/auth/me") {
      if (!isBetterAuthEnabled() || !auth) {
        return Response.json({ authenticated: false });
      }
      try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user) {
          return Response.json({ authenticated: false });
        }
        const { getUserByEmail, createUser } = await import("./db/users");
        const { getOrgMemberRole, addOrgMember } = await import("./db/org-members");
        const meOrgId = DEFAULT_ORG_ID; // TODO: resolve from session org plugin
        let hubUser = session.user.email
          ? await getUserByEmail(meOrgId, session.user.email)
          : null;
        // Auto-create hub user for authenticated Better Auth users
        if (!hubUser && session.user.email) {
          const { getUsersByOrg } = await import("./db/users");
          const existingUsers = await getUsersByOrg(meOrgId);
          hubUser = await createUser({
            orgId: meOrgId,
            name: session.user.name ?? session.user.email,
            email: session.user.email,
            authMethod: "betterauth",
          });
          // First user in the org becomes admin
          const role = existingUsers.length === 0 ? "admin" : "member";
          await addOrgMember(meOrgId, hubUser.id, role);
        }
        let orgRole = hubUser
          ? await getOrgMemberRole(meOrgId, hubUser.id)
          : null;
        // Promote sole member to admin (bootstrap case)
        if (hubUser && orgRole === "member") {
          const { getOrgMembers } = await import("./db/org-members");
          const members = await getOrgMembers(meOrgId);
          if (members.length === 1) {
            await addOrgMember("default", hubUser.id, "admin");
            orgRole = "admin";
          }
        }
        let role: "admin" | "operator" | "viewer" = "viewer";
        if (orgRole === "admin") role = "admin";
        else if (orgRole === "member") role = "operator";
        return Response.json({
          authenticated: true,
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          },
          role,
          hubUserId: hubUser?.id ?? null,
        });
      } catch {
        return Response.json({ authenticated: false });
      }
    }

    // Status dashboard (JSON)
    if (req.method === "GET" && url.pathname === "/status") {
      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
      if (authError) return authError;

      const allAgents = ctx.orchestrator ? await ctx.orchestrator.getStatusWithMemory() : [];
      // Filter agents by orgId (in standalone mode, all agents belong to the requesting org)
      const agents = allAgents.filter(a => !a.orgId || a.orgId === orgId);
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

      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
      if (authError) return authError;

      const machineStatuses = ctx.machineRegistry?.getCachedStatusForOrg(orgId) ?? [];

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

      const tokenHash = req.headers.get("X-Machine-Token-Hash");
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
        // Authenticate via token hash (pre-hashed by machine) or raw API key
        const hash = tokenHash
          ?? (token ? new Bun.CryptoHasher("sha256").update(token).digest("hex") : null);
        if (hash) {
          const dbAuth = await authenticateMachine(hash);
          console.log(`[Hub] Heartbeat auth: machine="${machineName}", hasToken=${!!token}, dbMatch=${!!dbAuth}, dbName="${dbAuth?.machineName}"`);
          if (dbAuth) {
            ctx.machineRegistry?.register(machineName, heartbeatMachineUrl ?? "", token, dbAuth.orgId);
            machine = ctx.machineRegistry?.get(machineName);
            await updateMachineLastSeen(dbAuth.machineId);
          }
        } else {
          console.log(`[Hub] Heartbeat auth: machine="${machineName}", no token provided`);
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

    // Receive agent completion events from machines
    if (req.method === "POST" && url.pathname === "/hub/agent-complete") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const tokenHash = req.headers.get("X-Machine-Token-Hash");
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      const body = await req.json();
      const { machineName, completion } = body as {
        machineName: string;
        completion: {
          key: string;
          issueId: string;
          issueIdentifier: string;
          issueTitle: string;
          linearProject?: string;
          completionReason: string;
          finalLinearState?: string;
          duration: number;
        };
      };

      if (!machineName || !completion) {
        return new Response("Missing machineName or completion", { status: 400 });
      }

      // Authenticate the same way as heartbeat
      const { authenticateMachine } = await import("./db");
      let authenticated = false;
      let machineOrgId = DEFAULT_ORG_ID;

      const machine = ctx.machineRegistry?.get(machineName);
      if (machine) {
        if (!machine.apiKey || machine.apiKey === token) {
          authenticated = true;
        }
      } else {
        const hash = tokenHash
          ?? (token ? new Bun.CryptoHasher("sha256").update(token).digest("hex") : null);
        if (hash) {
          const dbAuth = await authenticateMachine(hash);
          if (dbAuth) {
            authenticated = true;
            machineOrgId = dbAuth.orgId;
          }
        }
      }

      if (!authenticated) {
        return new Response("Unauthorized", { status: 403 });
      }

      const orgId = machineOrgId;
      await recordCompletedTask(orgId, {
        key: completion.key,
        issueId: completion.issueId,
        issueIdentifier: completion.issueIdentifier,
        issueTitle: completion.issueTitle,
        linearProject: completion.linearProject,
        completedAt: new Date(),
        completionReason: completion.completionReason,
        finalLinearState: completion.finalLinearState,
        duration: completion.duration,
      });

      console.log(`[Hub] Agent completion from ${machineName}: ${completion.issueIdentifier} (${completion.completionReason})`);

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

    // Self-service PAT endpoints (accessible by the user themselves)
    {
      const patMatch = url.pathname.match(/^\/hub\/api\/users\/([^/]+)\/(linear-pats?)$/);
      if (patMatch) {
        const orgId = await resolveApiOrgId(req);
        const authError = await requireViewer(req, orgId);
        if (authError) return authError;

        const targetUserId = patMatch[1];
        const api = await import("./hub/api");

        if (patMatch[2] === "linear-pats" && req.method === "GET") {
          return api.handleGetUserLinearPats(orgId, targetUserId);
        }
        if (patMatch[2] === "linear-pat" && req.method === "POST") {
          return api.handleSetUserLinearPat(req, orgId, targetUserId);
        }
        if (patMatch[2] === "linear-pat" && req.method === "DELETE") {
          return api.handleDeleteUserLinearPat(req, orgId, targetUserId);
        }
      }
    }

    // Hub API endpoints for entity management
    if (url.pathname.startsWith("/hub/api/")) {
      const orgId = await resolveApiOrgId(req);
      const authError = await requireAdmin(req, orgId);
      if (authError) return authError;
      const parts = url.pathname.split("/").filter(Boolean); // ["hub", "api", "users", ...]

      const resource = parts[2];
      const resourceId = parts[3];
      const subResource = parts[4];
      const subResourceId = parts[5];

      const api = await import("./hub/api");

      // Users
      if (resource === "users") {
        if (!resourceId && req.method === "GET") return api.handleGetUsers(orgId);
        if (!resourceId && req.method === "POST") return api.handleCreateUser(req, orgId);
        if (resourceId && !subResource && req.method === "DELETE") return api.handleDeleteUser(orgId, resourceId);
        if (resourceId && subResource === "linear-pat" && req.method === "POST") return api.handleSetUserLinearPat(req, orgId, resourceId);
        if (resourceId && subResource === "realms" && req.method === "GET") return api.handleGetUserRealms(resourceId);
      }

      // Projects
      if (resource === "projects") {
        if (!resourceId && req.method === "GET") return api.handleGetProjects(orgId);
        if (!resourceId && req.method === "POST") return api.handleCreateProject(req, orgId);
        if (resourceId && !subResource && req.method === "PUT") return api.handleUpdateProject(req, orgId, resourceId);
        if (resourceId && !subResource && req.method === "DELETE") return api.handleDeleteProject(orgId, resourceId);
        if (resourceId && subResource === "members" && !subResourceId && req.method === "GET") return api.handleGetProjectMembers(resourceId);
        if (resourceId && subResource === "members" && !subResourceId && req.method === "POST") return api.handleAddProjectMember(req, resourceId);
        if (resourceId && subResource === "members" && subResourceId && req.method === "DELETE") return api.handleRemoveProjectMember(resourceId, subResourceId);
      }

      // Realms
      if (resource === "realms") {
        if (!resourceId && req.method === "GET") return api.handleGetRealms(orgId);
        if (!resourceId && req.method === "POST") return api.handleCreateRealm(req, orgId);
        if (resourceId && !subResource && req.method === "PUT") return api.handleUpdateRealm(req, orgId, resourceId);
        if (resourceId && !subResource && req.method === "DELETE") return api.handleDeleteRealm(orgId, resourceId);
        if (resourceId && subResource === "members" && !subResourceId && req.method === "GET") return api.handleGetRealmMembers(resourceId);
        if (resourceId && subResource === "members" && !subResourceId && req.method === "POST") return api.handleAddRealmMember(req, resourceId);
        if (resourceId && subResource === "members" && subResourceId && req.method === "DELETE") return api.handleRemoveRealmMember(resourceId, subResourceId);
      }

      // Machines
      if (resource === "machines") {
        if (!resourceId && req.method === "GET") return api.handleGetMachines(orgId);
        if (resourceId && subResource === "projects" && !subResourceId && req.method === "GET") return api.handleGetMachineProjects(resourceId);
        if (resourceId && subResource === "projects" && !subResourceId && req.method === "POST") return api.handleAddMachineProject(req, resourceId);
        if (resourceId && subResource === "projects" && subResourceId && req.method === "DELETE") return api.handleRemoveMachineProject(resourceId, subResourceId);
        if (resourceId && subResource === "access" && !subResourceId && req.method === "GET") return api.handleGetMachineAccess(resourceId);
        if (resourceId && subResource === "access" && !subResourceId && req.method === "POST") return api.handleAddMachineAccess(req, resourceId);
        if (resourceId && subResource === "access" && subResourceId && req.method === "DELETE") return api.handleRemoveMachineAccess(resourceId, subResourceId);
      }

      return new Response("Not Found", { status: 404 });
    }

    // Completed tasks history
    if (req.method === "GET" && url.pathname === "/status/history") {
      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
      if (authError) return authError;

      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      // Machine mode: use local SQLite; otherwise use Postgres
      if (isMachineMode() && ctx.persistence) {
        const completedTasksList = ctx.persistence.getCompletedTasks(limit, offset);
        const total = ctx.persistence.getCompletedTasksCount();
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
      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
      if (authError) return authError;

      const { realmConfig, legacyConfig } = await getOrgConfig(orgId);

      const setup = realmConfig
        ? {
            realms: realmConfig.realms.map((realm) => ({
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
              agentName: realmConfig.global.agentName,
              port: realmConfig.global.port,
              triggerStates: realmConfig.global.triggerStates,
              useWorktrees: realmConfig.global.useWorktrees,
              defaultProfile: realmConfig.global.defaultProfile,
              security: realmConfig.global.security,
            },
          }
        : null;

      // Cloud deployments (Better Auth enabled) are effectively hub mode,
      // but machines should stay "machine" even with Better Auth (for Tailscale auth)
      const actualMode = getRuntimeMode();
      const effectiveMode = isBetterAuthEnabled() && actualMode !== "machine" ? "hub" : actualMode;

      return Response.json({
        linearWorkspace: legacyConfig.linearWorkspace,
        machineName: machineConfig.name,
        runtimeMode: effectiveMode,
        setup,
      });
    }

    // Config YAML (read raw)
    if (req.method === "GET" && url.pathname === "/config/yaml") {
      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
      if (authError) return authError;
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
      const orgId = await resolveApiOrgId(req);
      const authError = await requireAdmin(req, orgId);
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
      const orgId = await resolveApiOrgId(req);
      const authError = await requireAdmin(req, orgId);
      if (authError) return authError;
      const yamlContent = await req.text();
      const result = reloadConfig(yamlContent, orgId);

      if (result.success) {
        return Response.json({ success: true });
      }
      return Response.json({ success: false, errors: result.errors }, { status: 400 });
    }

    // Manual trigger endpoint
    if (req.method === "POST" && url.pathname === "/trigger") {
      const orgId = await resolveApiOrgId(req);
      const authError = await requireOperator(req, orgId);
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
        const apiKey = await resolveLinearApiKey(DEFAULT_ORG_ID, teamKey);
        const env = apiKey
          ? { ...process.env, LINEAR_API_KEY: apiKey }
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
      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
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
      const orgId = await resolveApiOrgId(req);
      const authError = await requireOperator(req, orgId);
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

      const orgId = await resolveApiOrgId(req);
      const authError = await requireViewer(req, orgId);
      if (authError) return authError;

      const resources = await getSystemResources();
      return Response.json(resources);
    }

    return new Response("Not Found", { status: 404 });
  };
}

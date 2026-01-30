// ABOUTME: Amadeus orchestrator server - receives Linear webhooks and manages Claude Code agents.
// ABOUTME: Entry point for the Bun server.

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
  getServerPort,
  getMachineUrlForProject,
  getRuntimeMode,
  isHubMode,
  isMachineMode,
  isStandaloneMode,
} from "./config";
import { MachineRegistry } from "./hub/registry";
import { IdleScanner } from "./hub/idle-scanner";
import { routeWebhook } from "./hub/router";
import { RouterHeartbeat } from "./router-heartbeat";
import { HubHeartbeat } from "./hub-heartbeat";
import { verifyLinearSignature } from "./signature";
import { requireAuth as checkAuth, getAuthInfo, isClerkEnabled } from "./auth";
import { ClaudeOrchestrator, type AgentDeathInfo, type AgentCompletionInfo } from "./orchestrator";
import { buildPrompt, buildCommentPrompt, buildRecoveryPrompt } from "./prompt";
import { isBotComment } from "./comment-filter";
import { AgentPersistence } from "./persistence";
import { HealthMonitor } from "./health-monitor";
import type { LinearWebhookPayload, LinearIssue, LinearComment, AgentStatus } from "./types";
import dashboardHtml from "./dashboard/index.html";
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

async function requireViewer(req: Request): Promise<Response | null> {
  const security = getSecurityConfig();
  // Skip auth for public dashboards (read-only access)
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

// Mode-based initialization
const machineConfig = getMachineConfig();
console.log(`[Server] Starting in ${getRuntimeMode()} mode as "${machineConfig.name}"`);

// Hub components (hub or standalone mode)
let machineRegistry: MachineRegistry | null = null;
if (isHubMode() || isStandaloneMode()) {
  machineRegistry = new MachineRegistry();
  if (REALM_CONFIG?.machines) {
    machineRegistry.loadFromConfig(REALM_CONFIG.machines);
  }
}

// Machine components (machine or standalone mode)
let persistence: AgentPersistence | null = null;
let orchestrator: ClaudeOrchestrator | null = null;
let healthMonitor: HealthMonitor | null = null;

if (isMachineMode() || isStandaloneMode()) {
  // Initialize persistence layer
  persistence = new AgentPersistence(CONFIG.dbPath);

  // Handle agent death - persist state for recovery
  const handleAgentDeath = (info: AgentDeathInfo): void => {
    console.log(
      `[AgentDeath] Agent ${info.key} died (${info.reason}, exit code: ${info.exitCode})`
    );
    persistence!.markAgentDead(info.issueId);
  };

  // Handle agent completion - save to history
  const handleAgentComplete = (info: AgentCompletionInfo): void => {
    console.log(
      `[AgentComplete] Agent ${info.key} completed (${info.completionReason})`
    );
    persistence!.saveCompletedTask({
      key: info.key,
      issueId: info.issueId,
      issueIdentifier: info.issueIdentifier,
      issueTitle: info.issueTitle,
      linearProject: info.linearProject,
      completedAt: new Date(),
      completionReason: info.completionReason,
      finalLinearState: info.finalLinearState,
      duration: info.duration,
    });
  };

  orchestrator = new ClaudeOrchestrator({
    projectPaths: CONFIG.projectPaths,
    triggerStates: CONFIG.triggerStates,
    claudeBotUserId: CONFIG.claudeBotUserId,
    useWorktrees: CONFIG.useWorktrees,
    worktreesDir: CONFIG.worktreesDir,
    onAgentDeath: handleAgentDeath,
    onAgentComplete: handleAgentComplete,
    onAgentChange: () => {
      // Notify hub heartbeat immediately when agents change
      hubHeartbeat?.notifyAgentChange();
      healthMonitor?.notifyAgentCountChanged();
    },
    linearWorkspace: CONFIG.linearWorkspace,
    agentName: CONFIG.agentName,
    profilesDir: CONFIG.profilesDir,
    defaultProfile: CONFIG.defaultProfile,
    teamProfiles: CONFIG.teamProfiles,
  });

  // Initialize health monitor
  healthMonitor = new HealthMonitor({
    persistence,
    getAgents: () =>
      orchestrator!.getStatus().map((status) => ({
        key: status.key,
        issueId: status.issueId,
        issueIdentifier: status.issueIdentifier,
        issueTitle: status.issueTitle,
        projectPath: "", // Not exposed in status, health monitor doesn't need it
        port: status.port,
        linearState: status.linearState,
        worktreePath: status.worktreePath,
      })),
    onAgentUnresponsive: (info) => {
      console.log(
        `[HealthMonitor] Agent ${info.key} unresponsive: ${info.error}`
      );
      persistence!.markAgentDead(info.issueId);
    },
    checkIntervalMs: CONFIG.healthCheckIntervalMs,
    timeoutMs: CONFIG.healthCheckTimeoutMs,
  });

  // Start health monitoring
  healthMonitor.start();
}

// Initialize router heartbeat if configured and enabled in machine config
let routerHeartbeat: RouterHeartbeat | null = null;
const routerConfig = getRouterConfig();
if (routerConfig && machineConfig.heartbeat) {
  routerHeartbeat = new RouterHeartbeat({
    routerUrl: routerConfig.url,
    machineName: routerConfig.machineName,
    secret: routerConfig.secret,
  });
  routerHeartbeat.start();
} else if (routerConfig && !machineConfig.heartbeat) {
  console.log("[RouterHeartbeat] Heartbeat disabled in machine config");
}

// Initialize hub heartbeat if machine has hubUrl configured
let hubHeartbeat: HubHeartbeat | null = null;
if (isMachineMode() && machineConfig.hubUrl) {
  const getAgents = async () => {
    return orchestrator ? await orchestrator.getStatusWithMemory() : [];
  };

  hubHeartbeat = new HubHeartbeat(
    {
      hubUrl: machineConfig.hubUrl,
      machineName: machineConfig.name,
      machineUrl: `http://localhost:${getServerPort()}`,
      apiKey: process.env.AMADEUS_API_KEY,
    },
    getAgents
  );

  hubHeartbeat.start();
  console.log(`[HubHeartbeat] Pushing status to ${machineConfig.hubUrl}`);
}

// Initialize idle scanner for hub/standalone mode
let idleScanner: IdleScanner | null = null;

if ((isHubMode() || isStandaloneMode()) && machineRegistry) {
  const idleConfig = REALM_CONFIG?.global?.idleTermination ?? {
    enabled: true,
    timeoutMinutes: 15,
    idleStates: ["Needs Feedback"],
    scanIntervalSeconds: 60,
  };

  const stopRemoteAgent = async (machineUrl: string, agentKey: string) => {
    // For local machine (empty URL), stop directly
    if (!machineUrl && orchestrator) {
      await orchestrator.stopAgent(agentKey, "stopped");
      return;
    }

    // For remote machines, use proxy
    const machine = machineRegistry!.getAll().find(m => m.url === machineUrl);
    if (!machine) {
      throw new Error(`Machine not found for URL: ${machineUrl}`);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (machine.apiKey) {
      headers["Authorization"] = `Bearer ${machine.apiKey}`;
    }

    const res = await fetch(`${machineUrl}/agents/${encodeURIComponent(agentKey)}/stop`, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  };

  idleScanner = new IdleScanner(idleConfig, machineRegistry, stopRemoteAgent);
  idleScanner.start();
}

function isComment(data: LinearIssue | LinearComment): data is LinearComment {
  return "body" in data && "issueId" in data;
}

function isDraft(issue: LinearIssue): boolean {
  // Draft issues have state type "triage" or state name containing "Draft"
  const stateType = issue.state?.type?.toLowerCase();
  const stateName = issue.state?.name?.toLowerCase() ?? "";
  return stateType === "triage" || stateName.includes("draft");
}

function shouldTerminateAgent(issue: LinearIssue): boolean {
  const stateName = issue.state?.name?.toLowerCase() ?? "";
  const stateType = issue.state?.type?.toLowerCase() ?? "";

  // Terminate agents when issues move to done, backlog, or canceled states
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

  // Send email notification if configured
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

  // Send Telegram notification if configured
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
  // Guard: Machine components required
  if (!orchestrator || !healthMonitor) {
    console.error("[Webhook] Machine components not initialized");
    return;
  }

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
    await orchestrator.stopAgent(agentKey, "canceled");
    healthMonitor.notifyAgentCountChanged();
    hubHeartbeat?.notifyAgentChange();
    return;
  }

  // Terminate agent if issue moved to backlog or canceled
  if (shouldTerminateAgent(issue)) {
    const existingKey = orchestrator.findAgentByIssueId(issue.id);
    if (existingKey) {
      // Update state before stopping so it gets captured as finalLinearState
      if (issue.state?.name) {
        orchestrator.updateIssueState(existingKey, issue.state.name);
      }
      const reason = getCompletionReason(issue);
      console.log(
        `[${new Date().toISOString()}] Terminating agent for ${issue.identifier} - moved to ${issue.state?.name} (${reason})`
      );
      await orchestrator.stopAgent(existingKey, reason);
      healthMonitor.notifyAgentCountChanged();
    hubHeartbeat?.notifyAgentChange();
    }
    return;
  }

  // Update Linear state if agent exists (for dashboard display)
  if (orchestrator.hasAgent(agentKey) && issue.state?.name) {
    const previousState = orchestrator.getAgentState(agentKey);
    orchestrator.updateIssueState(agentKey, issue.state.name);

    // Send notification on state transitions
    sendStateNotification(previousState, issue.state.name, issue).catch(
      (err) => console.error("[Notification] Error:", err)
    );
  }

  if (orchestrator.shouldStartAgent(issue)) {
    if (orchestrator.hasAgent(agentKey)) {
      // Fetch workflow states for dynamic state IDs
      let workflowStates;
      const realmInfo = issue.team?.key ? getRealmByTeamKey(issue.team.key) : undefined;
      if (realmInfo?.apiKey && issue.team?.key) {
        workflowStates = await fetchTeamWorkflowStates(issue.team.key, realmInfo.apiKey);
      }
      await orchestrator.sendMessage(
        agentKey,
        buildPrompt(issue, undefined, CONFIG.linearWorkspace, CONFIG.agentName, undefined, undefined, workflowStates)
      );
    } else {
      await orchestrator.startAgent(issue);
      healthMonitor.notifyAgentCountChanged();
    hubHeartbeat?.notifyAgentChange();
    }
  }
}

async function handleCommentWebhook(
  action: string,
  comment: LinearComment
): Promise<void> {
  // Guard: Machine components required
  if (!orchestrator || !healthMonitor || !persistence) {
    console.error("[Webhook] Machine components not initialized");
    return;
  }

  // Only handle new comments
  if (action !== "create") return;

  // Skip comments on draft issues
  if (isDraft(comment.issue)) {
    console.log(
      `[${new Date().toISOString()}] Skipping comment on draft issue: ${comment.issue.identifier}`
    );
    return;
  }

  // Skip comments from the bot itself to prevent self-responses
  if (isBotComment(comment, CONFIG.claudeBotUserId, CONFIG.agentName)) {
    console.log(
      `[${new Date().toISOString()}] Skipping bot comment on ${comment.issue.identifier}`
    );
    return;
  }

  console.log(
    `[${new Date().toISOString()}] Comment ${action}: ${comment.issue.identifier} from ${comment.user?.name ?? "unknown"}`
  );

  let agentKey = orchestrator.findAgentByIssueId(comment.issueId);

  // Spawn a new agent if one doesn't exist for this issue
  if (!agentKey) {
    // Webhook data may be incomplete (missing labels/state), so fetch full issue details
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

    // Spawn if issue meets trigger criteria OR is awaiting feedback (human response resumes work)
    const shouldSpawn = orchestrator.shouldStartAgent(issue) || orchestrator.isAwaitingFeedback(issue);
    if (!shouldSpawn) {
      console.log(
        `[${new Date().toISOString()}] Ignoring comment on ${issue.identifier} - does not meet trigger criteria (state: ${issue.state?.name}, labels: ${issue.labels?.map(l => l.name).join(", ") ?? "none"})`
      );
      return;
    }

    // Log why we're spawning
    if (orchestrator.isAwaitingFeedback(issue)) {
      console.log(
        `[${new Date().toISOString()}] Spawning agent for ${issue.identifier} - feedback response received`
      );
    }

    // Update comment.issue with full details for downstream use
    comment.issue = issue;

    // Check if we have saved state for this issue (recovering from crash)
    const savedState = persistence.getAgentByIssueId(comment.issueId);

    if (savedState?.status === "dead") {
      console.log(
        `[${new Date().toISOString()}] Recovering agent for ${comment.issue.identifier} from saved state`
      );

      // Start a new agent
      await orchestrator.startAgent(comment.issue);
      healthMonitor.notifyAgentCountChanged();
    hubHeartbeat?.notifyAgentChange();
      agentKey = orchestrator.findAgentByIssueId(comment.issueId);

      if (!agentKey) {
        console.error(
          `[${new Date().toISOString()}] Failed to spawn recovery agent for ${comment.issue.identifier}`
        );
        return;
      }

      // Fetch workflow states for dynamic state IDs in recovery prompt
      let workflowStates;
      if (realmInfo?.apiKey && issue.team?.key) {
        workflowStates = await fetchTeamWorkflowStates(issue.team.key, realmInfo.apiKey);
      }

      // Send recovery prompt with context, then the comment
      const recoveryPrompt = buildRecoveryPrompt(comment.issue, savedState, undefined, CONFIG.agentName, workflowStates);
      await orchestrator.sendMessage(agentKey, recoveryPrompt);

      // Mark agent as alive again in persistence
      persistence.markAgentAlive(comment.issueId);
    } else {
      // No saved state, spawn fresh agent
      console.log(
        `[${new Date().toISOString()}] No active agent for ${comment.issue.identifier} - spawning new agent`
      );
      await orchestrator.startAgent(comment.issue);
      healthMonitor.notifyAgentCountChanged();
    hubHeartbeat?.notifyAgentChange();
      agentKey = orchestrator.findAgentByIssueId(comment.issueId);

      if (!agentKey) {
        console.error(
          `[${new Date().toISOString()}] Failed to spawn agent for ${comment.issue.identifier}`
        );
        return;
      }
    }
  }

  await orchestrator.sendMessage(agentKey, buildCommentPrompt(comment));
}

/**
 * Forward a webhook to a remote machine (fire and forget).
 */
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

    // Forward Linear signature for verification
    if (signature) {
      headers["linear-signature"] = signature;
    }

    // Forward router secret if configured
    const routerConfig = getRouterConfig();
    if (routerConfig) {
      headers["X-Amadeus-Secret"] = routerConfig.secret;
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

/**
 * Get team key from webhook payload.
 */
function getTeamKeyFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.identifier?.split("-")[0] ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.identifier?.split("-")[0] ?? null;
  }

  return null;
}

/**
 * Get project name from webhook payload.
 */
function getProjectNameFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;

  if (type === "Issue" && !isComment(data)) {
    return data.project?.name ?? null;
  } else if (type === "Comment" && isComment(data)) {
    // Comment webhooks have project info nested in issue
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

const DONE_STATE_ID = "edbec4af-dc30-4d27-a122-84395ac3b885";
const PR_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function checkMergedPRsAndUpdateLinear(): Promise<void> {
  // Skip in hub mode - no local agents
  if (!orchestrator) return;

  const reviewAgents = orchestrator.getAgentsInReviewState();

  if (reviewAgents.length === 0) {
    return;
  }

  console.log(
    `[PR Check] Checking ${reviewAgents.length} agent(s) in Review state for merged PRs`
  );

  for (const agent of reviewAgents) {
    const projectPath = agent.worktreePath ?? CONFIG.projectPaths[agent.issueIdentifier.split("-")[0]] ?? "";

    if (!projectPath) {
      console.warn(
        `[PR Check] No project path for agent ${agent.issueIdentifier}, skipping`
      );
      continue;
    }

    const prStatus = await checkPRMerged(agent.issueIdentifier, projectPath);

    if (prStatus.merged) {
      console.log(
        `[PR Check] PR merged for ${agent.issueIdentifier}, updating Linear to Done`
      );

      try {
        // Use realm-specific API key for this issue
        const teamKey = agent.issueIdentifier.split("-")[0];
        const realmInfo = getRealmByTeamKey(teamKey);
        const env = realmInfo?.apiKey ? { ...process.env, LINEAR_API_KEY: realmInfo.apiKey } : process.env;
        await $`linear-cli issues update ${agent.issueIdentifier} --state ${DONE_STATE_ID}`.env(env).quiet();
        console.log(
          `[PR Check] Successfully updated ${agent.issueIdentifier} to Done`
        );

        // Update local state tracking
        orchestrator.updateIssueState(agent.key, "Done");

        // Delete the branch now that PR is merged
        const branchResult = await deleteBranch(agent.issueIdentifier, projectPath);
        if (branchResult.success) {
          console.log(
            `[PR Check] Deleted branch for ${agent.issueIdentifier} (local: ${branchResult.localDeleted}, remote: ${branchResult.remoteDeleted})`
          );
        }
      } catch (err) {
        console.error(
          `[PR Check] Failed to update Linear for ${agent.issueIdentifier}:`,
          err
        );
      }
    } else if (prStatus.state === "NO_PR") {
      // No PR exists yet, this is normal
    } else if (prStatus.state === "ERROR") {
      console.warn(
        `[PR Check] Error checking PR for ${agent.issueIdentifier}: ${prStatus.error}`
      );
    }
  }
}

const serverPort = getServerPort();

export const server = Bun.serve({
  port: serverPort,

  routes: {
    "/dashboard": dashboardHtml,
  },

  async fetch(req) {
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
    if (req.method === "POST" && url.pathname === "/webhook") {
      const payload = await req.text();
      const signature = req.headers.get("linear-signature");

      // Verify authentication: either API key (from hub) or Linear signature (direct)
      let verifiedRealm: string | null = null;
      const machineApiKey = process.env.AMADEUS_API_KEY;
      const hubSecret = req.headers.get("X-Amadeus-Secret");

      if (machineApiKey && hubSecret) {
        // Machine mode: verify API key from hub (hub already verified Linear signature)
        if (hubSecret !== machineApiKey) {
          console.warn("[Webhook] Invalid hub secret");
          return new Response("Unauthorized", { status: 401 });
        }
        // Hub secret valid - trusted from hub
      } else if (routerConfig) {
        // Legacy router mode: verify router secret
        if (hubSecret !== routerConfig.secret) {
          console.warn("[Webhook] Invalid router secret");
          return new Response("Unauthorized", { status: 401 });
        }
      } else {
        // Direct mode: verify Linear signature
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

      // Validate timestamp to prevent replay attacks
      const MAX_AGE_MS = 60000; // 60 seconds tolerance
      const now = Date.now();
      const webhookTimestamp = data.webhookTimestamp;

      if (!webhookTimestamp || Math.abs(now - webhookTimestamp) > MAX_AGE_MS) {
        console.warn(`[Webhook] Timestamp validation failed: ${webhookTimestamp}`);
        return new Response("Unauthorized", { status: 401 });
      }

      // In hub mode, route to machines
      if (isHubMode()) {
        const route = routeWebhook(data);
        if (route.machineUrl) {
          forwardWebhookToMachine(route.machineUrl, payload, signature, route.machineName ?? "unknown").catch((err) => {
            console.error("[HubForward] Error:", err);
          });
          return new Response("OK", { status: 200 });
        }
        // No routing configured - return error in hub mode
        console.warn(`[Webhook] Hub mode but no machine routing configured: ${route.reason}`);
        return new Response("No machine configured for this webhook", { status: 422 });
      }

      // Machine or standalone mode - process locally
      if (!orchestrator) {
        return new Response("Machine components not initialized", { status: 500 });
      }

      // Check if this project should be forwarded to a remote machine
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

      // Process locally (async, respond immediately)
      handleWebhook(data).catch((err) => {
        console.error("[Webhook] Error handling webhook:", err);
      });

      return new Response("OK", { status: 200 });
    }

    // Auth info endpoint (for frontend to know auth mode)
    if (req.method === "GET" && url.pathname === "/auth/info") {
      return Response.json(getAuthInfo());
    }

    // Status dashboard (JSON)
    if (req.method === "GET" && url.pathname === "/status") {
      const authError = await requireViewer(req);
      if (authError) return authError;

      // In hub mode, return empty agents (aggregate from machines in future)
      const agents = orchestrator ? await orchestrator.getStatusWithMemory() : [];
      return Response.json({
        agents,
        timestamp: new Date().toISOString(),
        mode: getRuntimeMode(),
      });
    }

    // Hub status endpoint (returns all machines and their agents from cache)
    if (req.method === "GET" && url.pathname === "/hub/status") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const authError = await requireViewer(req);
      if (authError) return authError;

      // Get cached status from registry (no fan-out to machines!)
      const machineStatuses = machineRegistry?.getCachedStatus() ?? [];

      // Include local machine if in standalone mode
      let localStatus = null;
      if (isStandaloneMode() && orchestrator) {
        const agents = await orchestrator.getStatusWithMemory();
        localStatus = {
          name: machineConfig.name,
          url: "", // Empty URL signals to dashboard this is local (no proxy needed)
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

      // Authenticate machine via API key
      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");

      const body = await req.json();
      const { machineName, machineUrl, agents } = body as {
        machineName: string;
        machineUrl?: string;
        agents?: AgentStatus[];
      };

      if (!machineName) {
        return new Response("Missing machineName", { status: 400 });
      }

      // Verify machine is registered and token matches
      const machine = machineRegistry?.get(machineName);
      if (!machine) {
        return new Response("Unknown machine", { status: 403 });
      }
      if (machine.apiKey && machine.apiKey !== token) {
        return new Response("Invalid token", { status: 403 });
      }

      // Update cached status in registry
      machineRegistry?.updateStatus(machineName, "healthy", agents ?? []);

      console.log(`[Hub] Heartbeat from ${machineName}: ${agents?.length ?? 0} agents`);

      return new Response("OK", { status: 200 });
    }

    // Hub proxy for remote machine agent messages
    // No browser auth required - hub handles machine auth using stored API keys
    if (req.method === "POST" && url.pathname === "/hub/proxy/messages") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const body = await req.json();
      const { machineUrl, taskKey } = body as { machineUrl: string; taskKey: string };

      if (!machineUrl || !taskKey) {
        return new Response("Missing machineUrl or taskKey", { status: 400 });
      }

      // Find machine to get API key
      const machine = machineRegistry?.getAll().find(m => m.url === machineUrl);
      const headers: Record<string, string> = {};
      if (machine?.apiKey) {
        headers["Authorization"] = `Bearer ${machine.apiKey}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${machineUrl}/agents/${encodeURIComponent(taskKey)}/messages`, {
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
    // No browser auth required - hub handles machine auth using stored API keys
    if (req.method === "POST" && url.pathname === "/hub/proxy/stop") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const body = await req.json();
      const { machineUrl, taskKey } = body as { machineUrl: string; taskKey: string };

      if (!machineUrl || !taskKey) {
        return new Response("Missing machineUrl or taskKey", { status: 400 });
      }

      // Find machine to get API key
      const machine = machineRegistry?.getAll().find(m => m.url === machineUrl);
      const headers: Record<string, string> = {};
      if (machine?.apiKey) {
        headers["Authorization"] = `Bearer ${machine.apiKey}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${machineUrl}/agents/${encodeURIComponent(taskKey)}/stop`, {
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

    // Hub proxy for remote machine trigger (send message to agent)
    // No browser auth required - hub handles machine auth using stored API keys
    if (req.method === "POST" && url.pathname === "/hub/proxy/trigger") {
      if (!isHubMode() && !isStandaloneMode()) {
        return new Response("Not available in machine mode", { status: 404 });
      }

      const body = await req.json();
      const { machineUrl, agentKey, message } = body as { machineUrl: string; agentKey: string; message: string };

      if (!machineUrl || !agentKey) {
        return new Response("Missing machineUrl or agentKey", { status: 400 });
      }

      // Find machine to get API key
      const machine = machineRegistry?.getAll().find(m => m.url === machineUrl);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (machine?.apiKey) {
        headers["Authorization"] = `Bearer ${machine.apiKey}`;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${machineUrl}/trigger`, {
          method: "POST",
          signal: controller.signal,
          headers,
          body: JSON.stringify({ agentKey, message }),
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return new Response(await res.text(), { status: res.status });
        }
        // Trigger returns plain text "Sent", not JSON
        const text = await res.text();
        return new Response(text, { status: res.status });
      } catch (err) {
        console.error("[Hub] Proxy trigger error:", err);
        return new Response("Failed to trigger agent on remote machine", { status: 502 });
      }
    }

    // Completed tasks history
    if (req.method === "GET" && url.pathname === "/status/history") {
      const authError = await requireViewer(req);
      if (authError) return authError;

      // In hub mode, no local history (aggregate from machines in future)
      if (!persistence) {
        return Response.json({
          completedTasks: [],
          total: 0,
          limit: 20,
          offset: 0,
        });
      }

      const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

      const completedTasks = persistence.getCompletedTasks(limit, offset);
      const total = persistence.getCompletedTasksCount();

      return Response.json({
        completedTasks: completedTasks.map((task) => ({
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

      // Build setup data from REALM_CONFIG, filtering out sensitive fields
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

      const yaml = getConfigYaml();
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

      const yamlContent = await req.text();
      const result = reloadConfig(yamlContent);

      if (result.success) {
        return Response.json({ success: true });
      }
      return Response.json({ success: false, errors: result.errors }, { status: 400 });
    }

    // Manual trigger endpoint
    if (req.method === "POST" && url.pathname === "/trigger") {
      const authError = await requireOperator(req);
      if (authError) return authError;

      if (!orchestrator) {
        return new Response("Machine components not initialized", { status: 500 });
      }

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

    // Telegram webhook endpoint for receiving replies
    if (req.method === "POST" && url.pathname === "/telegram-webhook") {
      try {
        const update = await req.json();

        // Telegram sends updates with message object
        const messageText = update?.message?.text;
        if (!messageText) {
          return new Response("OK"); // Acknowledge but ignore non-text messages
        }

        const parsed = parseIssueFromMessage(messageText);
        if (!parsed) {
          console.log(
            `[Telegram] Received message without valid issue format: ${messageText.slice(0, 50)}...`
          );
          return new Response("OK"); // Acknowledge but ignore invalid format
        }

        console.log(
          `[Telegram] Received reply for ${parsed.issueIdentifier}: ${parsed.message.slice(0, 50)}...`
        );

        // Post the message as a Linear comment on the issue
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
        return new Response("OK"); // Always return OK to prevent Telegram retries
      }
    }

    // Agent messages proxy endpoint
    const messagesMatch = url.pathname.match(/^\/agents\/([^/]+)\/messages$/);
    if (req.method === "GET" && messagesMatch) {
      const authError = await requireViewer(req);
      if (authError) return authError;

      if (!orchestrator) {
        return new Response("Machine components not initialized", { status: 500 });
      }

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

    // Stop agent endpoint (for dashboard)
    const stopMatch = url.pathname.match(/^\/agents\/([^/]+)\/stop$/);
    if (req.method === "POST" && stopMatch) {
      const authError = await requireOperator(req);
      if (authError) return authError;

      if (!orchestrator || !healthMonitor) {
        return new Response("Machine components not initialized", { status: 500 });
      }

      const agentKey = decodeURIComponent(stopMatch[1]);
      console.log(`[${new Date().toISOString()}] Manual stop requested for agent: ${agentKey}`);
      await orchestrator.stopAgent(agentKey, "stopped");
      healthMonitor.notifyAgentCountChanged();
    hubHeartbeat?.notifyAgentChange();
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
  },
});

// Start polling for merged PRs (unless disabled)
let prCheckInterval: ReturnType<typeof setInterval> | null = null;
if (!CONFIG.disablePRCheck) {
  prCheckInterval = setInterval(() => {
    checkMergedPRsAndUpdateLinear().catch((err) => {
      console.error("[PR Check] Error during PR merge check:", err);
    });
  }, PR_CHECK_INTERVAL_MS);
}

async function shutdown(): Promise<void> {
  console.log("\nShutting down...");

  // Stop health monitoring
  if (healthMonitor) {
    healthMonitor.stop();
  }

  // Stop router heartbeat if running
  if (routerHeartbeat) {
    routerHeartbeat.stop();
  }

  // Stop hub heartbeat if running
  if (hubHeartbeat) {
    hubHeartbeat.stop();
  }

  // Stop idle scanner if running
  if (idleScanner) {
    idleScanner.stop();
  }

  if (prCheckInterval) {
    clearInterval(prCheckInterval);
  }

  // Stop all agents
  if (orchestrator) {
    for (const status of orchestrator.getStatus()) {
      await orchestrator.stopAgent(status.key);
    }
  }

  // Close persistence connection
  if (persistence) {
    persistence.close();
  }

  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`🎼 Amadeus listening on http://localhost:${server.port}`);
console.log(`   Webhook:   https://your-machine.ts.net/webhook`);
console.log(`   Status:    http://localhost:${server.port}/status`);
console.log(`   Dashboard: http://localhost:${server.port}/dashboard`);
console.log(`   PR Check:  ${CONFIG.disablePRCheck ? "Disabled" : `Every ${PR_CHECK_INTERVAL_MS / 1000 / 60} minutes`}`);

if (routerConfig) {
  console.log(`   Router:    ${routerConfig.url} (as "${routerConfig.machineName}")`);
}

if (!isClerkEnabled() && !CONFIG.apiToken) {
  console.warn(
    "\n⚠️  WARNING: No authentication configured!\n" +
    "   Set AMADEUS_API_TOKEN or configure Clerk to secure your instance.\n" +
    "   All API endpoints will deny access until authentication is configured.\n"
  );
}

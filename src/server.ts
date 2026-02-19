// ABOUTME: Amadeus orchestrator server - receives Linear webhooks and manages Claude Code agents.
// ABOUTME: Entry point for the Bun server.

import { $ } from "bun";
import {
  initConfig,
  CONFIG,
  REALM_CONFIG,
  resolveLinearApiKey,
  getRouterConfig,
  getMachineConfig,
  getServerPort,
  getRuntimeMode,
  isHubMode,
  isMachineMode,
  isStandaloneMode,
} from "./config";
import {
  getMachines,
  recordCompletedTask,
} from "./db";
import { MachineRegistry } from "./hub/registry";
import { WsConnections, type WsConnectionData } from "./hub/ws-connections";
import { IdleScanner } from "./hub/idle-scanner";
import { RouterHeartbeat } from "./router-heartbeat";
import { HubHeartbeat } from "./hub-heartbeat";
import { HubConnection } from "./hub-connection";
import { ClaudeOrchestrator, type AgentDeathInfo, type AgentCompletionInfo } from "./orchestrator";
import { AgentPersistence } from "./persistence";
import { HealthMonitor } from "./health-monitor";
import { isBetterAuthEnabled } from "./auth";
import dashboardHtml from "./dashboard/index.html";
import { checkPRMerged, deleteBranch } from "./github";
import { createFetchHandler, type ServerContext } from "./create-server";
import {
  parseWsMessage,
  type MachineToHubMessage,
  type BrowserToHubMessage,
} from "./ws-protocol";

// Initialize config from Postgres (seeds from local YAML on first run)
await initConfig();

// Mode-based initialization
const machineConfig = getMachineConfig();
console.log(`[Server] Starting in ${getRuntimeMode()} mode as "${machineConfig.name}"`);

// Hub components (hub or standalone mode)
let machineRegistry: MachineRegistry | null = null;
let wsConnections: WsConnections | null = null;
if (isHubMode() || isStandaloneMode()) {
  machineRegistry = new MachineRegistry();
  wsConnections = new WsConnections();
  const dbMachines = await getMachines("default");
  if (dbMachines.length > 0) {
    machineRegistry.loadFromDb(dbMachines);
    console.log(`[Server] Loaded ${dbMachines.length} machine(s) from database`);
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

  // Handle agent completion - save to Postgres or forward to hub
  const handleAgentComplete = (info: AgentCompletionInfo): void => {
    console.log(
      `[AgentComplete] Agent ${info.key} completed (${info.completionReason})`
    );
    if (isMachineMode()) {
      hubConnection?.reportCompletion(info);
      hubHeartbeat?.reportCompletion(info);
      persistence?.saveCompletedTask({
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
    } else {
      recordCompletedTask("default", {
        key: info.key,
        issueId: info.issueId,
        issueIdentifier: info.issueIdentifier,
        issueTitle: info.issueTitle,
        linearProject: info.linearProject,
        completedAt: new Date(),
        completionReason: info.completionReason,
        finalLinearState: info.finalLinearState,
        duration: info.duration,
      }).catch((err) => {
        console.error("[AgentComplete] Failed to persist to database:", err);
      });
    }
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
      hubConnection?.notifyAgentChange();
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

// Initialize hub connection (WebSocket) if machine has hubUrl configured
let hubConnection: HubConnection | null = null;
if (isMachineMode() && machineConfig.hubUrl && machineConfig.token) {
  const getAgents = async () => {
    return orchestrator ? await orchestrator.getStatusWithMemory() : [];
  };

  hubConnection = new HubConnection(
    {
      hubUrl: machineConfig.hubUrl,
      machineName: machineConfig.name,
      token: machineConfig.token,
      onStopCommand: async (agentKey, reason) => {
        if (orchestrator?.hasAgent(agentKey)) {
          console.log(`[HubConnection] Stopping agent ${agentKey} (${reason})`);
          await orchestrator.stopAgent(agentKey, reason as any);
          healthMonitor?.notifyAgentCountChanged();
        }
      },
      onWebhook: (payload, signature, routing) => {
        // Process webhook as if received via HTTP
        server.fetch(new Request(`http://localhost:${getServerPort()}/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(signature ? { "linear-signature": signature } : {}),
            ...(process.env.AMADEUS_API_KEY ? { "X-Amadeus-Secret": process.env.AMADEUS_API_KEY } : {}),
          },
          body: routing
            ? JSON.stringify({ ...JSON.parse(payload), _routing: routing })
            : payload,
        })).catch(err => console.error("[HubConnection] Webhook processing error:", err));
      },
      onGetMessages: async (agentKey) => {
        if (!orchestrator) return [];
        const agent = orchestrator.getStatus().find(a => a.key === agentKey);
        if (!agent) return [];
        try {
          const res = await fetch(`http://localhost:${agent.port}/messages`);
          return await res.json();
        } catch {
          return [];
        }
      },
      onTrigger: async (agentKey, message) => {
        if (!orchestrator) return false;
        try {
          await orchestrator.sendMessage(agentKey, message);
          return true;
        } catch {
          return false;
        }
      },
    },
    getAgents
  );

  hubConnection.start();
  console.log(`[HubConnection] Connecting via WebSocket to ${machineConfig.hubUrl}`);
}

// Initialize hub heartbeat (HTTP fallback) if machine has hubUrl but no token for WS
let hubHeartbeat: HubHeartbeat | null = null;
if (isMachineMode() && machineConfig.hubUrl && !hubConnection) {
  const getAgents = async () => {
    return orchestrator ? await orchestrator.getStatusWithMemory() : [];
  };

  hubHeartbeat = new HubHeartbeat(
    {
      hubUrl: machineConfig.hubUrl,
      machineName: machineConfig.name,
      machineUrl: `http://localhost:${getServerPort()}`,
      apiKey: process.env.AMADEUS_API_KEY,
      token: machineConfig.token,
      onStopCommand: async (agentKey, reason) => {
        if (orchestrator?.hasAgent(agentKey)) {
          console.log(`[HubHeartbeat] Stopping agent ${agentKey} (${reason})`);
          await orchestrator.stopAgent(agentKey, reason as any);
          healthMonitor?.notifyAgentCountChanged();
        }
      },
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

    // For remote machines, prefer WebSocket for instant delivery
    const machine = machineRegistry!.getAll().find(m => m.url === machineUrl);
    if (!machine) {
      throw new Error(`Machine not found for URL: ${machineUrl}`);
    }

    if (wsConnections?.isConnected(machine.name)) {
      const sent = wsConnections.send(machine.name, {
        type: "stop",
        agentKey,
        reason: "idle",
      });
      if (sent) {
        console.log(`[IdleScanner] Sent stop command for ${agentKey} to ${machine.name} via WebSocket`);
        return;
      }
    }

    // Fallback to heartbeat queue
    machineRegistry!.queueStopCommand(machine.name, agentKey, "idle");
    console.log(`[IdleScanner] Queued stop command for ${agentKey} on ${machine.name}`);
  };

  idleScanner = new IdleScanner(idleConfig, machineRegistry, stopRemoteAgent);
  idleScanner.start();
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
        // Use resolved API key for this issue
        const teamKey = agent.issueIdentifier.split("-")[0];
        const apiKey = await resolveLinearApiKey("default", teamKey);
        const homeBin = `${process.env.HOME}/.local/bin`;
        const basePath = process.env.PATH?.includes(homeBin) ? process.env.PATH : `${homeBin}:${process.env.PATH}`;
        const key = apiKey ?? process.env.LINEAR_API_KEY ?? process.env.LINEAR_TOKEN;
        const env = { ...process.env, PATH: basePath };
        await $`linear-cli issues update --api-key ${key} ${agent.issueIdentifier} --state ${DONE_STATE_ID}`.env(env).quiet();
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

const ctx: ServerContext = {
  orchestrator,
  machineRegistry,
  healthMonitor,
  persistence,
  hubHeartbeat,
  hubConnection,
  routerHeartbeat,
  idleScanner,
  wsConnections,
};
const handler = createFetchHandler(ctx);

const serverPort = getServerPort();

// Dashboard WebSocket subscriptions: browser ws → agentKey → poll timer
const dashboardSubscriptions = new Map<
  import("bun").ServerWebSocket<WsConnectionData>,
  Map<string, ReturnType<typeof setInterval>>
>();

async function fetchMessages(machineName: string | null, agentKey: string): Promise<unknown[]> {
  if (!machineName) {
    if (!orchestrator) return [];
    const agent = orchestrator.getStatus().find(a => a.key === agentKey);
    if (!agent) return [];
    try {
      const res = await fetch(`http://localhost:${agent.port}/messages`);
      const data = await res.json();
      return data?.messages ?? (Array.isArray(data) ? data : []);
    } catch {
      return [];
    }
  } else {
    if (!wsConnections?.isConnected(machineName)) return [];
    try {
      const requestId = crypto.randomUUID();
      const response = await wsConnections.sendRequest(machineName, {
        type: "get-messages",
        id: requestId,
        agentKey,
      });
      if (response.type === "messages-response") {
        const data = response.messages as any;
        return data?.messages ?? (Array.isArray(data) ? data : []);
      }
      return [];
    } catch {
      return [];
    }
  }
}

async function handleDashboardWsMessage(
  ws: import("bun").ServerWebSocket<WsConnectionData>,
  rawMsg: string | Buffer
): Promise<void> {
  let msg: BrowserToHubMessage;
  try {
    const str = typeof rawMsg === "string" ? rawMsg : rawMsg.toString("utf-8");
    msg = JSON.parse(str);
  } catch {
    return;
  }

  if (msg.type === "subscribe-messages") {
    const { machineName, agentKey } = msg;

    if (!dashboardSubscriptions.has(ws)) {
      dashboardSubscriptions.set(ws, new Map());
    }
    const subs = dashboardSubscriptions.get(ws)!;

    const existing = subs.get(agentKey);
    if (existing) clearInterval(existing);

    const sendUpdate = async () => {
      try {
        const messages = await fetchMessages(machineName, agentKey);
        ws.send(JSON.stringify({ type: "messages-update", agentKey, messages }));
      } catch (err) {
        ws.send(JSON.stringify({ type: "messages-error", agentKey, error: String(err) }));
      }
    };

    // Send initial response immediately, then poll every second
    sendUpdate().catch(() => {});
    subs.set(agentKey, setInterval(sendUpdate, 1000));

  } else if (msg.type === "unsubscribe-messages") {
    const subs = dashboardSubscriptions.get(ws);
    if (subs) {
      const timer = subs.get(msg.agentKey);
      if (timer) {
        clearInterval(timer);
        subs.delete(msg.agentKey);
      }
    }
  }
}

// WebSocket handler for hub mode (machines connect to this)
async function handleWsAuth(
  ws: import("bun").ServerWebSocket<WsConnectionData>,
  msg: MachineToHubMessage
): Promise<void> {
  if (msg.type !== "auth") {
    ws.send(JSON.stringify({ type: "auth-fail", reason: "Expected auth message" }));
    ws.close(1008, "Expected auth message");
    return;
  }

  const { authenticateMachine, updateMachineLastSeen } = await import("./db");
  const dbAuth = await authenticateMachine(msg.tokenHash);

  if (!dbAuth) {
    console.log(`[WS] Auth failed for machine "${msg.machineName}"`);
    ws.send(JSON.stringify({ type: "auth-fail", reason: "Invalid token" }));
    ws.close(1008, "Invalid token");
    return;
  }

  ws.data.machineName = msg.machineName;
  ws.data.machineId = dbAuth.machineId;
  ws.data.orgId = dbAuth.orgId;
  ws.data.authenticated = true;

  // Register in both places
  machineRegistry?.register(msg.machineName, dbAuth.url ?? "", machineConfig.token);
  wsConnections?.register(msg.machineName, ws);
  await updateMachineLastSeen(dbAuth.machineId);

  ws.send(JSON.stringify({ type: "auth-ok" }));
  console.log(`[WS] Machine "${msg.machineName}" authenticated`);
}

async function handleWsMessage(
  ws: import("bun").ServerWebSocket<WsConnectionData>,
  msg: MachineToHubMessage
): Promise<void> {
  if (!ws.data.authenticated || !ws.data.machineName) return;

  switch (msg.type) {
    case "heartbeat": {
      machineRegistry?.updateStatus(ws.data.machineName, "healthy", msg.agents);
      console.log(`[WS] Heartbeat from ${ws.data.machineName}: ${msg.agents.length} agents`);

      // Drain any pending stop commands (for backward compatibility during migration)
      const stopCommands = machineRegistry?.drainStopCommands(ws.data.machineName) ?? [];
      for (const cmd of stopCommands) {
        ws.send(JSON.stringify({ type: "stop", agentKey: cmd.agentKey, reason: cmd.reason }));
      }

      ws.send(JSON.stringify({ type: "heartbeat-ack" }));
      break;
    }

    case "agent-complete": {
      const orgId = ws.data.orgId ?? "default";
      await recordCompletedTask(orgId, {
        key: msg.completion.key,
        issueId: msg.completion.issueId,
        issueIdentifier: msg.completion.issueIdentifier,
        issueTitle: msg.completion.issueTitle,
        linearProject: msg.completion.linearProject,
        completedAt: new Date(),
        completionReason: msg.completion.completionReason,
        finalLinearState: msg.completion.finalLinearState,
        duration: msg.completion.duration,
      });
      console.log(`[WS] Agent completion from ${ws.data.machineName}: ${msg.completion.issueIdentifier} (${msg.completion.completionReason})`);
      break;
    }

    case "messages-response":
    case "trigger-response": {
      wsConnections?.handleResponse(msg);
      break;
    }
  }
}

export const server = Bun.serve<WsConnectionData>({
  port: serverPort,

  routes: {
    "/dashboard": dashboardHtml,
  },

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for machine connections
    if (url.pathname === "/ws" && (isHubMode() || isStandaloneMode())) {
      const upgraded = server.upgrade(req, {
        data: {
          connectionType: "machine" as const,
          machineName: null,
          machineId: null,
          orgId: null,
          authenticated: false,
        },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // WebSocket upgrade for browser dashboard connections
    if (url.pathname === "/ws/dashboard") {
      const upgraded = server.upgrade(req, {
        data: {
          connectionType: "browser" as const,
          machineName: null,
          machineId: null,
          orgId: null,
          authenticated: false,
        },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return handler(req);
  },

  websocket: {
    open(ws) {
      console.log(`[WS] New ${ws.data.connectionType} connection`);
    },

    message(ws, message) {
      if (ws.data.connectionType === "browser") {
        handleDashboardWsMessage(ws, message as string).catch(err =>
          console.error("[Dashboard WS] Error:", err)
        );
        return;
      }

      const msg = parseWsMessage(message as string);
      if (!msg) {
        console.warn("[WS] Unparseable message");
        return;
      }

      // Type guard: only handle machine→hub messages
      if (!("type" in msg)) return;
      const machineMsg = msg as MachineToHubMessage;

      if (!ws.data.authenticated) {
        handleWsAuth(ws, machineMsg).catch(err =>
          console.error("[WS] Auth error:", err)
        );
      } else {
        handleWsMessage(ws, machineMsg).catch(err =>
          console.error("[WS] Message error:", err)
        );
      }
    },

    close(ws, code, reason) {
      if (ws.data.connectionType === "browser") {
        const subs = dashboardSubscriptions.get(ws);
        if (subs) {
          for (const timer of subs.values()) clearInterval(timer);
          dashboardSubscriptions.delete(ws);
        }
        return;
      }

      if (ws.data.machineName) {
        wsConnections?.remove(ws.data.machineName, ws);
        console.log(`[WS] Machine "${ws.data.machineName}" disconnected (code=${code})`);
      }
    },

    ping(ws) {},
    pong(ws) {},
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

  // Stop hub connection if running
  if (hubConnection) {
    hubConnection.stop();
  }

  // Stop hub heartbeat if running
  if (hubHeartbeat) {
    hubHeartbeat.stop();
  }

  // Stop idle scanner if running
  if (idleScanner) {
    idleScanner.stop();
  }

  // Close WebSocket connections
  if (wsConnections) {
    wsConnections.close();
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
console.log(`   WebSocket: ws://localhost:${server.port}/ws`);
console.log(`   Status:    http://localhost:${server.port}/status`);
console.log(`   Dashboard: http://localhost:${server.port}/dashboard`);
console.log(`   PR Check:  ${CONFIG.disablePRCheck ? "Disabled" : `Every ${PR_CHECK_INTERVAL_MS / 1000 / 60} minutes`}`);

if (routerConfig) {
  console.log(`   Router:    ${routerConfig.url} (as "${routerConfig.machineName}")`);
}

if (!isBetterAuthEnabled() && !CONFIG.apiToken) {
  console.warn(
    "\n⚠️  WARNING: No authentication configured!\n" +
    "   Set AMADEUS_API_TOKEN or configure Better Auth to secure your instance.\n" +
    "   All API endpoints will deny access until authentication is configured.\n"
  );
}

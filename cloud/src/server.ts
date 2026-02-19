// ABOUTME: Cloud server entry point wrapping amadeus with session-based org resolution.
// ABOUTME: Initializes amadeus components and serves the cloud dashboard.

import {
  initConfig,
  CONFIG,
  REALM_CONFIG,
  getRealmByTeamKey,
  getRouterConfig,
  getMachineConfig,
  getServerPort,
  getRuntimeMode,
  isHubMode,
  isMachineMode,
  isStandaloneMode,
} from "../../src/config";
import { getMachines, recordCompletedTask } from "../../src/db";
import { isBetterAuthEnabled } from "../../src/auth";
import { createFetchHandler, type ServerContext } from "../../src/create-server";
import { createCloudHandler } from "./cloud-handler";
import { migrateCloud } from "./db/cloud-db";
import amadeusHtml from "../../src/dashboard/index.html";
import setupHtml from "./dashboard/index.html";
import {
  parseWsMessage,
  type MachineToHubMessage,
  type BrowserToHubMessage,
} from "../../src/ws-protocol";
import type { WsConnectionData } from "../../src/hub/ws-connections";

// Initialize config from Postgres
await initConfig();
await migrateCloud();

// Create Better Auth tables if they don't exist
if (isBetterAuthEnabled()) {
  const { sql } = await import("bun");
  await sql`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      "emailVerified" BOOLEAN,
      image TEXT,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id),
      token TEXT UNIQUE,
      "expiresAt" TIMESTAMP,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id),
      "accountId" TEXT,
      "providerId" TEXT,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMP,
      "refreshTokenExpiresAt" TIMESTAMP,
      scope TEXT,
      "idToken" TEXT,
      password TEXT,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT,
      value TEXT,
      "expiresAt" TIMESTAMP,
      "createdAt" TIMESTAMP,
      "updatedAt" TIMESTAMP
    )
  `;
  console.log("[Cloud] Better Auth tables ensured");
}

const machineConfig = getMachineConfig();
console.log(`[Cloud] Starting in ${getRuntimeMode()} mode as "${machineConfig.name}"`);

// Dynamic imports for amadeus components (not all are re-exported)
const { MachineRegistry } = await import("../../src/hub/registry.ts");
const { WsConnections } = await import("../../src/hub/ws-connections.ts");
const { IdleScanner } = await import("../../src/hub/idle-scanner.ts");
const { RouterHeartbeat } = await import("../../src/router-heartbeat.ts");
const { HubHeartbeat } = await import("../../src/hub-heartbeat.ts");
const { ClaudeOrchestrator } = await import("../../src/orchestrator.ts");
const { AgentPersistence } = await import("../../src/persistence.ts");
const { HealthMonitor } = await import("../../src/health-monitor.ts");

// Hub components (hub or standalone mode)
let machineRegistry: InstanceType<typeof MachineRegistry> | null = null;
let wsConnections: InstanceType<typeof WsConnections> | null = null;
if (isHubMode() || isStandaloneMode()) {
  machineRegistry = new MachineRegistry();
  wsConnections = new WsConnections();
  const dbMachines = await getMachines("default");
  if (dbMachines.length > 0) {
    machineRegistry.loadFromDb(dbMachines);
    console.log(`[Cloud] Loaded ${dbMachines.length} machine(s) from database`);
  }
}

// Machine components (machine or standalone mode)
let persistence: InstanceType<typeof AgentPersistence> | null = null;
let orchestrator: InstanceType<typeof ClaudeOrchestrator> | null = null;
let healthMonitor: InstanceType<typeof HealthMonitor> | null = null;

if (isMachineMode() || isStandaloneMode()) {
  persistence = new AgentPersistence(CONFIG.dbPath);

  const handleAgentDeath = (info: { key: string; issueId: string; exitCode?: number; reason: string }): void => {
    console.log(`[AgentDeath] Agent ${info.key} died (${info.reason}, exit code: ${info.exitCode})`);
    persistence!.markAgentDead(info.issueId);
  };

  const handleAgentComplete = (info: {
    key: string; issueId: string; issueIdentifier: string; issueTitle: string;
    linearProject?: string; completionReason: string; finalLinearState?: string; duration: number;
  }): void => {
    console.log(`[AgentComplete] Agent ${info.key} completed (${info.completionReason})`);
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
      hubHeartbeat?.notifyAgentChange();
      healthMonitor?.notifyAgentCountChanged();
    },
    linearWorkspace: CONFIG.linearWorkspace,
    agentName: CONFIG.agentName,
    profilesDir: CONFIG.profilesDir,
    defaultProfile: CONFIG.defaultProfile,
    teamProfiles: CONFIG.teamProfiles,
  });

  healthMonitor = new HealthMonitor({
    persistence,
    getAgents: () =>
      orchestrator!.getStatus().map((status: any) => ({
        key: status.key,
        issueId: status.issueId,
        issueIdentifier: status.issueIdentifier,
        issueTitle: status.issueTitle,
        projectPath: "",
        port: status.port,
        linearState: status.linearState,
        worktreePath: status.worktreePath,
      })),
    onAgentUnresponsive: (info: { key: string; error: string; issueId: string }) => {
      console.log(`[HealthMonitor] Agent ${info.key} unresponsive: ${info.error}`);
      persistence!.markAgentDead(info.issueId);
    },
    checkIntervalMs: CONFIG.healthCheckIntervalMs,
    timeoutMs: CONFIG.healthCheckTimeoutMs,
  });

  healthMonitor.start();
}

// Router heartbeat
let routerHeartbeat: InstanceType<typeof RouterHeartbeat> | null = null;
const routerConfig = getRouterConfig();
if (routerConfig && machineConfig.heartbeat) {
  routerHeartbeat = new RouterHeartbeat({
    routerUrl: routerConfig.url,
    machineName: routerConfig.machineName,
    secret: routerConfig.secret,
  });
  routerHeartbeat.start();
}

// Hub heartbeat
let hubHeartbeat: InstanceType<typeof HubHeartbeat> | null = null;
if (isMachineMode() && machineConfig.hubUrl) {
  hubHeartbeat = new HubHeartbeat(
    {
      hubUrl: machineConfig.hubUrl,
      machineName: machineConfig.name,
      machineUrl: `http://localhost:${getServerPort()}`,
      apiKey: process.env.AMADEUS_API_KEY,
    },
    async () => orchestrator ? await orchestrator.getStatusWithMemory() : []
  );
  hubHeartbeat.start();
}

// Idle scanner
let idleScanner: InstanceType<typeof IdleScanner> | null = null;
if ((isHubMode() || isStandaloneMode()) && machineRegistry) {
  const idleConfig = REALM_CONFIG?.global?.idleTermination ?? {
    enabled: true,
    timeoutMinutes: 15,
    idleStates: ["Needs Feedback"],
    scanIntervalSeconds: 60,
  };

  idleScanner = new IdleScanner(idleConfig, machineRegistry, async (machineUrl: string, agentKey: string) => {
    if (!machineUrl && orchestrator) {
      await orchestrator.stopAgent(agentKey, "stopped");
      return;
    }
    const machine = machineRegistry!.getAll().find((m: any) => m.url === machineUrl);
    if (!machine) throw new Error(`Machine not found for URL: ${machineUrl}`);

    // Prefer WebSocket for instant delivery
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

    // Fallback to HTTP
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (machine.apiKey) headers["Authorization"] = `Bearer ${machine.apiKey}`;
    const res = await fetch(`${machineUrl}/agents/${encodeURIComponent(agentKey)}/stop`, { method: "POST", headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
  idleScanner.start();
}

const ctx: ServerContext = {
  orchestrator,
  machineRegistry,
  healthMonitor,
  persistence,
  hubHeartbeat,
  hubConnection: null,
  routerHeartbeat,
  idleScanner,
  wsConnections,
};

const handler = createCloudHandler(ctx);
const serverPort = getServerPort();

// Dashboard WebSocket subscriptions: browser ws → agentKey → poll timer
const dashboardSubscriptions = new Map<
  import("bun").ServerWebSocket<WsConnectionData>,
  Map<string, ReturnType<typeof setInterval>>
>();

async function fetchMessages(machineName: string | null, agentKey: string): Promise<unknown[]> {
  if (!machineName) {
    if (!orchestrator) return [];
    const agent = orchestrator.getStatus().find((a: any) => a.key === agentKey);
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

  const { authenticateMachine, updateMachineLastSeen } = await import("../../src/db");
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

  machineRegistry?.register(msg.machineName, dbAuth.url ?? "");
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
    "/dashboard": amadeusHtml,
    "/setup": setupHtml,
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

// Shutdown handler
async function shutdown(): Promise<void> {
  console.log("\nShutting down...");
  healthMonitor?.stop();
  routerHeartbeat?.stop();
  hubHeartbeat?.stop();
  idleScanner?.stop();
  wsConnections?.close();
  if (orchestrator) {
    for (const status of orchestrator.getStatus()) {
      await orchestrator.stopAgent(status.key);
    }
  }
  persistence?.close();
  server.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Amadeus Cloud listening on http://localhost:${server.port}`);
console.log(`  Dashboard: http://localhost:${server.port}/dashboard`);
console.log(`  WebSocket: ws://localhost:${server.port}/ws`);
console.log(`  Status:    http://localhost:${server.port}/status`);

if (!isBetterAuthEnabled()) {
  console.warn(
    "\nWARNING: Better Auth is not configured!\n" +
    "  Set BETTER_AUTH_SECRET for session-based authentication.\n"
  );
}

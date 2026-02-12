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
} from "amadeus/config";
import { getMachines, recordCompletedTask } from "amadeus/db";
import { isBetterAuthEnabled } from "amadeus/auth";
import { createFetchHandler, type ServerContext } from "amadeus/create-server";
import { createCloudHandler } from "./cloud-handler";
import { migrateCloud } from "./db/cloud-db";
import amadeusHtml from "amadeus/dashboard/index.html";
import setupHtml from "./dashboard/index.html";
import adminHtml from "./dashboard/admin.html";

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
const { MachineRegistry } = await import("amadeus/src/hub/registry.ts");
const { IdleScanner } = await import("amadeus/src/hub/idle-scanner.ts");
const { RouterHeartbeat } = await import("amadeus/src/router-heartbeat.ts");
const { HubHeartbeat } = await import("amadeus/src/hub-heartbeat.ts");
const { ClaudeOrchestrator } = await import("amadeus/src/orchestrator.ts");
const { AgentPersistence } = await import("amadeus/src/persistence.ts");
const { HealthMonitor } = await import("amadeus/src/health-monitor.ts");

// Hub components (hub or standalone mode)
let machineRegistry: InstanceType<typeof MachineRegistry> | null = null;
if (isHubMode() || isStandaloneMode()) {
  machineRegistry = new MachineRegistry();
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
  routerHeartbeat,
  idleScanner,
};

const handler = createCloudHandler(ctx);
const serverPort = getServerPort();

export const server = Bun.serve({
  port: serverPort,
  routes: {
    "/dashboard": amadeusHtml,
    "/cloud/setup": setupHtml,
    "/cloud/admin": adminHtml,
  },
  fetch: handler,
});

// Shutdown handler
async function shutdown(): Promise<void> {
  console.log("\nShutting down...");
  healthMonitor?.stop();
  routerHeartbeat?.stop();
  hubHeartbeat?.stop();
  idleScanner?.stop();
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
console.log(`  Admin:     http://localhost:${server.port}/cloud/admin`);
console.log(`  Status:    http://localhost:${server.port}/status`);

if (!isBetterAuthEnabled()) {
  console.warn(
    "\nWARNING: Better Auth is not configured!\n" +
    "  Set BETTER_AUTH_SECRET for session-based authentication.\n"
  );
}

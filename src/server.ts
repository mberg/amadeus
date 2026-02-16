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
import { IdleScanner } from "./hub/idle-scanner";
import { RouterHeartbeat } from "./router-heartbeat";
import { HubHeartbeat } from "./hub-heartbeat";
import { ClaudeOrchestrator, type AgentDeathInfo, type AgentCompletionInfo } from "./orchestrator";
import { AgentPersistence } from "./persistence";
import { HealthMonitor } from "./health-monitor";
import { isBetterAuthEnabled } from "./auth";
import dashboardHtml from "./dashboard/index.html";
import { checkPRMerged, deleteBranch } from "./github";
import { createFetchHandler, type ServerContext } from "./create-server";

// Initialize config from Postgres (seeds from local YAML on first run)
await initConfig();

// Mode-based initialization
const machineConfig = getMachineConfig();
console.log(`[Server] Starting in ${getRuntimeMode()} mode as "${machineConfig.name}"`);

// Hub components (hub or standalone mode)
let machineRegistry: MachineRegistry | null = null;
if (isHubMode() || isStandaloneMode()) {
  machineRegistry = new MachineRegistry();
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

    // For remote machines, queue stop command for delivery via heartbeat
    const machine = machineRegistry!.getAll().find(m => m.url === machineUrl);
    if (!machine) {
      throw new Error(`Machine not found for URL: ${machineUrl}`);
    }

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
  routerHeartbeat,
  idleScanner,
};
const handler = createFetchHandler(ctx);

const serverPort = getServerPort();

export const server = Bun.serve({
  port: serverPort,

  routes: {
    "/dashboard": dashboardHtml,
  },

  fetch: handler,
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

if (!isBetterAuthEnabled() && !CONFIG.apiToken) {
  console.warn(
    "\n⚠️  WARNING: No authentication configured!\n" +
    "   Set AMADEUS_API_TOKEN or configure Better Auth to secure your instance.\n" +
    "   All API endpoints will deny access until authentication is configured.\n"
  );
}

// ABOUTME: Supervisory orchestrator agent that actively monitors running agents.
// ABOUTME: Provides stall detection, Linear state reconciliation, and progress tracking.

import type { ClaudeOrchestrator } from "./orchestrator";
import type { AgentPersistence } from "./persistence";
import type { HealthMonitor } from "./health-monitor";
import { fetchIssueDetails } from "./linear";
import { resolveLinearApiKey } from "./config";

export interface OrchestratorAgentConfig {
  orchestrator: ClaudeOrchestrator;
  persistence: AgentPersistence;
  healthMonitor: HealthMonitor;

  /** How often to run the reconciliation tick (ms). Default: 60000 (1 min) */
  reconcileIntervalMs?: number;

  /** How long an agent can be in "working" status with no state change before considered stalled (ms). Default: 900000 (15 min) */
  stallTimeoutMs?: number;

  /** Terminal Linear states that should trigger agent termination. */
  terminalStates?: string[];

  /** Non-active states that should trigger agent termination (without workspace cleanup). */
  inactiveStates?: string[];

  /** Callback when an agent is stopped due to reconciliation. */
  onAgentReconciled?: (issueIdentifier: string, reason: string) => void;

  /** Callback when agent count changes (for hub heartbeat etc). */
  onAgentChange?: () => void;
}

interface AgentSnapshot {
  key: string;
  issueId: string;
  issueIdentifier: string;
  linearState?: string;
  status: string;
  uptime: number;
  lastReconcileAt: number;
  lastStateChangeAt: number;
  stallWarned: boolean;
}

export interface ReconcileResult {
  checked: number;
  terminated: number;
  stalled: number;
  updated: number;
  errors: string[];
}

const DEFAULT_RECONCILE_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_STALL_TIMEOUT_MS = 15 * 60_000; // 15 minutes

const DEFAULT_TERMINAL_STATES = [
  "done",
  "closed",
  "cancelled",
  "canceled",
  "duplicate",
];

const DEFAULT_INACTIVE_STATES = [
  "backlog",
  "todo",
  "triage",
];

export class OrchestratorAgent {
  private config: OrchestratorAgentConfig;
  private reconcileIntervalMs: number;
  private stallTimeoutMs: number;
  private terminalStates: Set<string>;
  private inactiveStates: Set<string>;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private snapshots = new Map<string, AgentSnapshot>();
  private lastReconcileAt: number = 0;
  private reconcileCount = 0;
  private totalTerminated = 0;
  private totalStalled = 0;

  constructor(config: OrchestratorAgentConfig) {
    this.config = config;
    this.reconcileIntervalMs = config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.stallTimeoutMs = config.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.terminalStates = new Set(
      (config.terminalStates ?? DEFAULT_TERMINAL_STATES).map(s => s.toLowerCase())
    );
    this.inactiveStates = new Set(
      (config.inactiveStates ?? DEFAULT_INACTIVE_STATES).map(s => s.toLowerCase())
    );
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    console.log(
      `[OrchestratorAgent] Starting reconciliation loop (interval: ${this.reconcileIntervalMs}ms, stall timeout: ${this.stallTimeoutMs}ms)`
    );

    // Run immediately, then on interval
    this.tick().catch(err => {
      console.error("[OrchestratorAgent] Initial tick error:", err);
    });

    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error("[OrchestratorAgent] Tick error:", err);
      });
    }, this.reconcileIntervalMs);
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[OrchestratorAgent] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats(): {
    running: boolean;
    reconcileCount: number;
    totalTerminated: number;
    totalStalled: number;
    lastReconcileAt: number;
    trackedAgents: number;
  } {
    return {
      running: this.running,
      reconcileCount: this.reconcileCount,
      totalTerminated: this.totalTerminated,
      totalStalled: this.totalStalled,
      lastReconcileAt: this.lastReconcileAt,
      trackedAgents: this.snapshots.size,
    };
  }

  /**
   * Main reconciliation tick. Runs on every interval.
   * 1. Sync local snapshots with current agent list
   * 2. Check each agent's Linear state for terminal/inactive transitions
   * 3. Detect stalled agents
   */
  async tick(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      checked: 0,
      terminated: 0,
      stalled: 0,
      updated: 0,
      errors: [],
    };

    const agents = this.config.orchestrator.getStatus();
    const now = Date.now();

    if (agents.length === 0) {
      // Clean up stale snapshots
      this.snapshots.clear();
      this.lastReconcileAt = now;
      this.reconcileCount++;
      return result;
    }

    // Sync snapshots: add new agents, remove gone agents
    const currentKeys = new Set(agents.map(a => a.key));
    for (const key of this.snapshots.keys()) {
      if (!currentKeys.has(key)) {
        this.snapshots.delete(key);
      }
    }

    for (const agent of agents) {
      if (!this.snapshots.has(agent.key)) {
        this.snapshots.set(agent.key, {
          key: agent.key,
          issueId: agent.issueId,
          issueIdentifier: agent.issueIdentifier,
          linearState: agent.linearState,
          status: agent.status,
          uptime: agent.uptime,
          lastReconcileAt: now,
          lastStateChangeAt: now,
          stallWarned: false,
        });
      }
    }

    // Reconcile each agent against Linear
    for (const agent of agents) {
      result.checked++;
      const snapshot = this.snapshots.get(agent.key)!;

      // Track state changes for stall detection
      if (snapshot.linearState !== agent.linearState || snapshot.status !== agent.status) {
        snapshot.linearState = agent.linearState;
        snapshot.status = agent.status;
        snapshot.lastStateChangeAt = now;
        snapshot.stallWarned = false;
      }

      // 1. Check Linear state via API for drift
      try {
        const teamKey = agent.issueIdentifier.split("-")[0];
        const apiKey = await resolveLinearApiKey("default", teamKey);

        if (apiKey) {
          const issueDetails = await fetchIssueDetails(agent.issueId, apiKey);

          if (issueDetails) {
            const currentStateName = issueDetails.state?.name?.toLowerCase() ?? "";
            const currentStateType = issueDetails.state?.type?.toLowerCase() ?? "";

            // Check terminal states
            if (
              this.terminalStates.has(currentStateName) ||
              currentStateType === "completed" ||
              currentStateType === "canceled"
            ) {
              console.log(
                `[OrchestratorAgent] Issue ${agent.issueIdentifier} is now in terminal state "${issueDetails.state?.name}" - stopping agent`
              );
              const reason = this.getCompletionReason(currentStateName, currentStateType);
              await this.config.orchestrator.stopAgent(agent.key, reason as any);
              this.snapshots.delete(agent.key);
              result.terminated++;
              this.totalTerminated++;
              this.config.onAgentReconciled?.(agent.issueIdentifier, `terminal: ${issueDetails.state?.name}`);
              this.config.onAgentChange?.();
              continue;
            }

            // Check inactive states (stop without workspace cleanup)
            if (
              this.inactiveStates.has(currentStateName) ||
              currentStateType === "backlog" ||
              currentStateType === "triage"
            ) {
              console.log(
                `[OrchestratorAgent] Issue ${agent.issueIdentifier} moved to inactive state "${issueDetails.state?.name}" - stopping agent`
              );
              await this.config.orchestrator.stopAgent(agent.key, "stopped");
              this.snapshots.delete(agent.key);
              result.terminated++;
              this.totalTerminated++;
              this.config.onAgentReconciled?.(agent.issueIdentifier, `inactive: ${issueDetails.state?.name}`);
              this.config.onAgentChange?.();
              continue;
            }

            // Update tracked state if it changed (non-terminal)
            if (issueDetails.state?.name && issueDetails.state.name !== agent.linearState) {
              this.config.orchestrator.updateIssueState(agent.key, issueDetails.state.name);
              snapshot.linearState = issueDetails.state.name;
              snapshot.lastStateChangeAt = now;
              result.updated++;
            }
          }
        }
      } catch (err) {
        const errMsg = `Failed to reconcile ${agent.issueIdentifier}: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[OrchestratorAgent] ${errMsg}`);
        result.errors.push(errMsg);
        // Don't stop agents on reconciliation errors - try again next tick
      }

      // 2. Stall detection
      const timeSinceStateChange = now - snapshot.lastStateChangeAt;
      if (timeSinceStateChange > this.stallTimeoutMs && !snapshot.stallWarned) {
        console.warn(
          `[OrchestratorAgent] Agent ${agent.issueIdentifier} appears stalled (no state change for ${Math.round(timeSinceStateChange / 60000)}min, status: ${agent.status})`
        );
        snapshot.stallWarned = true;
        result.stalled++;
        this.totalStalled++;
      }

      snapshot.lastReconcileAt = now;
    }

    this.lastReconcileAt = now;
    this.reconcileCount++;

    if (result.terminated > 0 || result.stalled > 0 || result.errors.length > 0) {
      console.log(
        `[OrchestratorAgent] Reconcile #${this.reconcileCount}: checked=${result.checked} terminated=${result.terminated} stalled=${result.stalled} updated=${result.updated} errors=${result.errors.length}`
      );
    }

    return result;
  }

  private getCompletionReason(stateName: string, stateType: string): string {
    if (stateType === "completed" || stateName.includes("done")) return "done";
    if (stateType === "canceled" || stateName.includes("cancel")) return "canceled";
    if (stateType === "backlog" || stateName.includes("backlog") || stateName.includes("todo")) return "backlog";
    return "stopped";
  }
}

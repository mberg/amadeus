// ABOUTME: Conservative reaping of orphaned agentapi processes.
// ABOUTME: Kills only untracked processes that are unresponsive or whose issue is terminal.

import type { ProcessInspector, AgentApiProcess } from "./process-inspector";

export interface ReapDecision {
  reap: boolean;
  reason: string;
}

export function shouldReap(input: {
  candidate: AgentApiProcess;
  trackedPorts: Set<number>;
  responsive: boolean;
  issueTerminal: boolean;
}): ReapDecision {
  const { candidate, trackedPorts, responsive, issueTerminal } = input;
  if (trackedPorts.has(candidate.port)) {
    return { reap: false, reason: "tracked" };
  }
  if (!responsive) {
    return { reap: true, reason: "unresponsive" };
  }
  if (issueTerminal) {
    return { reap: true, reason: "issue-terminal" };
  }
  return { reap: false, reason: "responsive-active" };
}

export interface ReapResult {
  killed: number[];
  spared: number[];
}

export interface ReapDeps {
  inspector: ProcessInspector;
  getTrackedPorts: () => Set<number>;
  isResponsive: (port: number) => Promise<boolean>;
  isIssueTerminal: (port: number) => Promise<boolean>;
  log?: (msg: string) => void;
  portRange?: { start: number; end: number };
}

export async function reapOrphans(deps: ReapDeps): Promise<ReapResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const candidates = await deps.inspector.list();
  const tracked = deps.getTrackedPorts();
  const killed: number[] = [];
  const spared: number[] = [];

  for (const c of candidates) {
    if (deps.portRange && (c.port < deps.portRange.start || c.port > deps.portRange.end)) {
      log(`[OrphanReaper] Skipping out-of-range pid=${c.pid} port=${c.port}`);
      continue;
    }
    if (tracked.has(c.port)) {
      spared.push(c.port);
      continue;
    }
    const responsive = await deps.isResponsive(c.port);
    const issueTerminal = responsive ? await deps.isIssueTerminal(c.port) : false;
    const decision = shouldReap({ candidate: c, trackedPorts: tracked, responsive, issueTerminal });

    if (decision.reap) {
      log(`[OrphanReaper] Killing orphan pid=${c.pid} port=${c.port} (${decision.reason})`);
      try {
        await deps.inspector.killTree(c.pid);
        killed.push(c.pid);
      } catch (err) {
        log(`[OrphanReaper] Failed to kill pid=${c.pid}: ${err}`);
      }
    } else {
      log(`[OrphanReaper] Sparing pid=${c.pid} port=${c.port} (${decision.reason})`);
      spared.push(c.port);
    }
  }

  log(`[OrphanReaper] Reap pass complete: ${killed.length} killed, ${spared.length} spared`);
  return { killed, spared };
}

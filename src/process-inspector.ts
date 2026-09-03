// ABOUTME: Enumerates and kills agentapi agent processes.
// ABOUTME: Parsing is pure/testable; killing uses pkill -P for cross-platform tree-kill.

import { $ } from "bun";

export interface AgentApiProcess {
  pid: number;
  port: number;
  command: string;
}

export interface ProcessInspector {
  list(): Promise<AgentApiProcess[]>;
  killTree(pid: number): Promise<void>;
}

/**
 * Pure parser. Expects each line as "<pid> <command...>".
 * Keeps only lines that are an agentapi server with a numeric --port.
 */
export function parseAgentApiProcesses(psOutput: string): AgentApiProcess[] {
  const out: AgentApiProcess[] = [];
  for (const raw of psOutput.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes("agentapi") || !line.includes("server")) continue;
    const portMatch = line.match(/--port\s+(\d+)\b/);
    if (!portMatch) continue;
    const fields = line.split(/\s+/);
    const pid = Number(fields[0]);
    if (!Number.isFinite(pid)) continue;
    out.push({
      pid,
      port: Number(portMatch[1]),
      command: fields.slice(1).join(" "),
    });
  }
  return out;
}

export class RealProcessInspector implements ProcessInspector {
  async list(): Promise<AgentApiProcess[]> {
    const output = await $`ps -axo pid=,command=`.text();
    return parseAgentApiProcesses(output);
  }

  /** SIGTERM the process and its direct children, wait, then SIGKILL the stragglers. */
  async killTree(pid: number): Promise<void> {
    await $`pkill -TERM -P ${pid}`.nothrow().quiet();
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
    await Bun.sleep(5000);
    await $`pkill -KILL -P ${pid}`.nothrow().quiet();
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

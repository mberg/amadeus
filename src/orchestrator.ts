// ABOUTME: Manages Claude Code agent instances for Linear issues.
// ABOUTME: Handles spawning, messaging, and stopping agent processes.

import { spawn, type Subprocess } from "bun";
import type { LinearIssue, AgentInstance, AgentStatus } from "./types";
import { buildPrompt } from "./prompt";

export interface OrchestratorConfig {
  projectPaths: Record<string, string>;
  triggerStates: string[];
  claudeBotUserId?: string;
}

export class ClaudeOrchestrator {
  private agents = new Map<string, AgentInstance>();
  private nextPort = 8001;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  shouldStartAgent(issue: LinearIssue): boolean {
    const stateMatch = this.config.triggerStates.includes(
      issue.state?.name ?? ""
    );
    const assigneeMatch =
      this.config.claudeBotUserId !== undefined &&
      issue.assignee?.id === this.config.claudeBotUserId;
    return stateMatch || assigneeMatch;
  }

  getAgentKey(issue: LinearIssue): string {
    const projectKey = issue.team?.key ?? "DEFAULT";
    return `${projectKey}-${issue.id}`;
  }

  getStatus(): AgentStatus[] {
    return Array.from(this.agents.entries()).map(([key, agent]) => ({
      key,
      port: agent.port,
      issueId: agent.linearIssueId,
      issueIdentifier: agent.issueIdentifier,
      status: agent.status,
      uptime: Date.now() - agent.startedAt.getTime(),
    }));
  }

  hasAgent(key: string): boolean {
    return this.agents.has(key);
  }

  async startAgent(issue: LinearIssue): Promise<void> {
    const key = this.getAgentKey(issue);
    const projectKey = issue.team?.key ?? "DEFAULT";
    const projectPath = this.config.projectPaths[projectKey];

    if (!projectPath) {
      console.error(`[Agent] No project path configured for team: ${projectKey}`);
      return;
    }

    if (this.agents.has(key)) {
      console.log(`[Agent] Agent already exists: ${key}`);
      return;
    }

    const port = this.nextPort++;
    console.log(`[Agent] Starting new agent on port ${port} for ${issue.identifier}`);

    const proc = spawn({
      cmd: ["agentapi", "server", "claude", "--port", String(port)],
      cwd: projectPath,
      env: {
        ...process.env,
        LINEAR_ISSUE_ID: issue.id,
        LINEAR_ISSUE_IDENTIFIER: issue.identifier,
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    this.agents.set(key, {
      process: proc,
      port,
      projectPath,
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      status: "starting",
      startedAt: new Date(),
    });

    await this.waitForAgent(port);

    const agent = this.agents.get(key)!;
    agent.status = "idle";

    await this.sendMessage(key, buildPrompt(issue));
  }

  private async waitForAgent(port: number, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) return;
      } catch {
        // Server not ready yet
      }
      await Bun.sleep(500);
    }
    throw new Error(`Agent on port ${port} failed to start`);
  }

  async sendMessage(key: string, message: string): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    agent.status = "working";

    try {
      await fetch(`http://localhost:${agent.port}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
    } catch (err) {
      console.error(`[Agent] Failed to send message to ${key}:`, err);
      agent.status = "idle";
    }
  }

  async stopAgent(key: string): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    console.log(`[Agent] Stopping agent: ${key}`);
    agent.process.kill();
    this.agents.delete(key);
  }
}

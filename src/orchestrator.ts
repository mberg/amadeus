// ABOUTME: Manages Claude Code agent instances for Linear issues.
// ABOUTME: Handles spawning, messaging, and stopping agent processes.

import { spawn, type Subprocess } from "bun";
import { dirname, join } from "node:path";
import type { LinearIssue, AgentInstance, AgentStatus, AgentProfile } from "./types";
import { buildPrompt } from "./prompt";
import { loadProfiles, resolveProfile, resolveAndMergeProfiles } from "./profiles";
import { createWorktree, removeWorktree, getWorktreePath } from "./worktree";

export interface OrchestratorConfig {
  projectPaths: Record<string, string>;
  triggerStates: string[];
  claudeBotUserId?: string;
  profilesDir?: string;
  defaultProfile?: string;
  teamProfiles?: Record<string, string>;
  useWorktrees?: boolean;
  worktreesDir?: string;
}

export class ClaudeOrchestrator {
  private agents = new Map<string, AgentInstance>();
  private nextPort = 8001;
  private config: OrchestratorConfig;
  private profiles: Record<string, AgentProfile> = {};
  private profilesLoaded = false;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async loadProfiles(): Promise<void> {
    if (this.profilesLoaded || !this.config.profilesDir) return;

    this.profiles = await loadProfiles(this.config.profilesDir);
    this.profilesLoaded = true;
    console.log(`[Agent] Loaded ${Object.keys(this.profiles).length} profiles`);
  }

  getProfileForIssue(issue: LinearIssue): AgentProfile {
    const teamKey = issue.team?.key;
    const teamDefault = teamKey ? this.config.teamProfiles?.[teamKey] : undefined;
    const defaultProfile = teamDefault ?? this.config.defaultProfile ?? "base";

    return resolveAndMergeProfiles(issue, this.profiles, defaultProfile);
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
      issueTitle: agent.issueTitle,
      linearState: agent.linearState,
      status: agent.status,
      uptime: Date.now() - agent.startedAt.getTime(),
      worktreePath: agent.worktreePath,
    }));
  }

  hasAgent(key: string): boolean {
    return this.agents.has(key);
  }

  findAgentByIssueId(issueId: string): string | null {
    for (const [key, agent] of this.agents.entries()) {
      if (agent.linearIssueId === issueId) {
        return key;
      }
    }
    return null;
  }

  updateIssueState(key: string, state: string): void {
    const agent = this.agents.get(key);
    if (agent) {
      agent.linearState = state;
    }
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

    await this.loadProfiles();
    const profile = this.getProfileForIssue(issue);

    const port = this.nextPort++;
    console.log(`[Agent] Starting new agent on port ${port} for ${issue.identifier}`);

    // Determine working directory (worktree or project root)
    let workingDir = projectPath;
    let worktreePath: string | undefined;

    if (this.config.useWorktrees !== false) {
      // Default worktrees dir is a sibling directory named .amadeus-worktrees
      const worktreesDir =
        this.config.worktreesDir ?? join(dirname(projectPath), ".amadeus-worktrees");

      const worktreeResult = await createWorktree({
        repoPath: projectPath,
        worktreesDir,
        issueIdentifier: issue.identifier,
      });

      if (worktreeResult.success && worktreeResult.worktreePath) {
        worktreePath = worktreeResult.worktreePath;
        workingDir = worktreePath;
        console.log(
          `[Agent] Created worktree at ${worktreePath} (branch: ${worktreeResult.branchName})`
        );
      } else {
        console.warn(
          `[Agent] Failed to create worktree for ${issue.identifier}: ${worktreeResult.error}`
        );
        console.log(`[Agent] Falling back to project root: ${projectPath}`);
      }
    }

    const proc = spawn({
      cmd: [
        "agentapi",
        "server",
        "claude",
        "--port",
        String(port),
        "--",
        "--dangerously-skip-permissions",
      ],
      cwd: workingDir,
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
      worktreePath,
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      linearState: issue.state?.name,
      status: "starting",
      startedAt: new Date(),
    });

    try {
      await this.waitForAgent(port);
      await this.waitForAgentReady(port);
    } catch (err) {
      console.error(`[Agent] Failed to start agent ${key}:`, err);
      proc.kill();
      // Clean up worktree if we created one
      if (worktreePath) {
        await removeWorktree({ repoPath: projectPath, worktreePath });
      }
      this.agents.delete(key);
      return;
    }

    const agent = this.agents.get(key)!;
    agent.status = "idle";

    await this.sendMessage(key, buildPrompt(issue, profile));
  }

  private async waitForAgent(port: number, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "stable" || data.status === "running") {
            return;
          }
        }
      } catch {
        // Server not ready yet
      }
      await Bun.sleep(500);
    }
    throw new Error(`Agent on port ${port} failed to start`);
  }

  private async waitForAgentReady(port: number, maxAttempts = 60): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const [statusRes, messagesRes] = await Promise.all([
          fetch(`http://localhost:${port}/status`),
          fetch(`http://localhost:${port}/messages`),
        ]);

        if (statusRes.ok && messagesRes.ok) {
          const status = await statusRes.json();
          const messages = await messagesRes.json();

          // Agent is ready when: stable status AND has at least one message
          if (status.status === "stable" && messages.messages?.length > 0) {
            console.log(`[Agent] Agent on port ${port} is ready`);
            return;
          }
        }
      } catch {
        // Not ready yet
      }
      await Bun.sleep(500);
    }
    throw new Error(`Agent on port ${port} never became ready`);
  }

  async sendMessage(key: string, message: string): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    agent.status = "working";
    console.log(`[Agent] Sending message to ${key} on port ${agent.port}`);

    try {
      const res = await fetch(`http://localhost:${agent.port}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message, type: "user" }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[Agent] Message send failed (${res.status}): ${text}`);
      } else {
        console.log(`[Agent] Message sent successfully to ${key}`);
      }

      agent.status = "idle";
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

    // Clean up worktree if one was created
    if (agent.worktreePath) {
      console.log(`[Agent] Removing worktree: ${agent.worktreePath}`);
      const result = await removeWorktree({
        repoPath: agent.projectPath,
        worktreePath: agent.worktreePath,
      });
      if (!result.success) {
        console.warn(`[Agent] Failed to remove worktree: ${result.error}`);
      }
    }

    this.agents.delete(key);
  }
}

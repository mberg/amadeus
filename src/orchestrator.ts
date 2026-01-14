// ABOUTME: Manages Claude Code agent instances for Linear issues.
// ABOUTME: Handles spawning, messaging, and stopping agent processes.

import { spawn, type Subprocess } from "bun";
import { dirname, join } from "node:path";
import type { LinearIssue, AgentInstance, AgentStatus, AgentProfile } from "./types";
import { buildPrompt } from "./prompt";
import { loadProfiles, resolveProfile, resolveAndMergeProfiles, resolveSkillLabels, mergeSkillProfiles } from "./profiles";
import { createWorktree, removeWorktree, getWorktreePath } from "./worktree";
import { applyProfileConfig } from "./profile-config";
import { getGitHubRepoUrl } from "./git-utils";
import { getRealmByTeamKey } from "./config";
import { getProcessMemoryMB } from "./process-memory";
import { processDescription } from "./image-downloader";

export interface AgentDeathInfo {
  key: string;
  issueId: string;
  issueIdentifier: string;
  exitCode: number | null;
  reason: "exited" | "crashed" | "killed";
}

export type CompletionReason = "done" | "stopped" | "canceled" | "backlog";

export interface AgentCompletionInfo {
  key: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  completionReason: CompletionReason;
  finalLinearState?: string;
  duration: number;
}

export interface OrchestratorConfig {
  projectPaths: Record<string, string>;
  triggerStates: string[];
  claudeBotUserId?: string;
  profilesDir?: string;
  defaultProfile?: string;
  teamProfiles?: Record<string, string>;
  useWorktrees?: boolean;
  worktreesDir?: string;
  onAgentDeath?: (info: AgentDeathInfo) => void;
  onAgentComplete?: (info: AgentCompletionInfo) => void;
  linearWorkspace?: string;
  agentName?: string;
}

// Simple hash function for message deduplication
function hashMessage(message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// Cache entry with timestamp for TTL
interface CacheEntry {
  hash: string;
  timestamp: number;
}

// Pending message entry for buffering
export interface PendingMessage {
  message: string;
  timestamp: number;
}

// Deduplication cache: agentKey -> recent message hashes
const MESSAGE_CACHE_TTL_MS = 60000; // 1 minute TTL
const MESSAGE_CACHE_MAX_SIZE = 20; // Max entries per agent

export class ClaudeOrchestrator {
  private agents = new Map<string, AgentInstance>();
  private stoppingAgents = new Set<string>(); // Track agents being intentionally stopped
  private messageCache = new Map<string, CacheEntry[]>(); // Deduplication cache
  private pendingMessages = new Map<string, PendingMessage[]>(); // Buffered messages for busy agents
  private pendingMessageTimer: ReturnType<typeof setInterval> | null = null;
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
    // Check if issue has the required agent label (case-insensitive)
    const agentName = this.config.agentName?.toLowerCase();
    const hasAgentLabel = agentName
      ? issue.labels?.some((l) => l.name.toLowerCase() === agentName) ?? false
      : true; // If no agent name configured, don't require label

    if (!hasAgentLabel) {
      return false;
    }

    const stateMatch = this.config.triggerStates.includes(
      issue.state?.name ?? ""
    );
    const assigneeMatch =
      this.config.claudeBotUserId !== undefined &&
      issue.assignee?.id === this.config.claudeBotUserId;
    return stateMatch || assigneeMatch;
  }

  getAgentKey(issue: LinearIssue): string {
    // Use project name if available, otherwise fall back to team key
    const projectKey = issue.project?.name ?? issue.team?.key ?? "DEFAULT";
    return `${projectKey}-${issue.id}`;
  }

  getStatus(): AgentStatus[] {
    return Array.from(this.agents.entries()).map(([key, agent]) => ({
      key,
      pid: agent.pid,
      port: agent.port,
      issueId: agent.linearIssueId,
      issueIdentifier: agent.issueIdentifier,
      issueTitle: agent.issueTitle,
      linearState: agent.linearState,
      activeSkills: agent.activeSkills,
      status: agent.status,
      uptime: Date.now() - agent.startedAt.getTime(),
      worktreePath: agent.worktreePath,
    }));
  }

  async getStatusWithMemory(): Promise<AgentStatus[]> {
    const statuses = this.getStatus();
    const memoryPromises = statuses.map((status) => getProcessMemoryMB(status.pid));
    const memories = await Promise.all(memoryPromises);

    return statuses.map((status, i) => ({
      ...status,
      memoryMB: memories[i],
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

  getAgentState(key: string): string | undefined {
    return this.agents.get(key)?.linearState;
  }

  getAgentDeathHandler(): ((info: AgentDeathInfo) => void) | undefined {
    return this.config.onAgentDeath;
  }

  getAgentsInReviewState(): AgentStatus[] {
    return this.getStatus().filter((agent) => agent.linearState === "Review");
  }

  // Pending message buffer methods
  bufferMessage(key: string, message: string): void {
    const pending = this.pendingMessages.get(key) ?? [];
    pending.push({ message, timestamp: Date.now() });
    this.pendingMessages.set(key, pending);
    console.log(`[Agent] Buffered message for ${key} (${pending.length} pending)`);
    this.startPendingMessageDelivery();
  }

  hasPendingMessages(key: string): boolean {
    const pending = this.pendingMessages.get(key);
    return pending !== undefined && pending.length > 0;
  }

  getPendingMessageCount(key: string): number {
    return this.pendingMessages.get(key)?.length ?? 0;
  }

  getPendingMessages(key: string): PendingMessage[] {
    return this.pendingMessages.get(key) ?? [];
  }

  clearPendingMessages(key: string): void {
    this.pendingMessages.delete(key);
  }

  private startPendingMessageDelivery(): void {
    if (this.pendingMessageTimer !== null) {
      return; // Already running
    }

    const DELIVERY_CHECK_INTERVAL_MS = 2000; // Check every 2 seconds

    this.pendingMessageTimer = setInterval(() => {
      this.deliverPendingMessages().catch((err) => {
        console.error("[Agent] Error delivering pending messages:", err);
      });
    }, DELIVERY_CHECK_INTERVAL_MS);

    console.log("[Agent] Started pending message delivery timer");
  }

  private stopPendingMessageDelivery(): void {
    if (this.pendingMessageTimer !== null) {
      clearInterval(this.pendingMessageTimer);
      this.pendingMessageTimer = null;
      console.log("[Agent] Stopped pending message delivery timer");
    }
  }

  private async deliverPendingMessages(): Promise<void> {
    // Check if there are any pending messages
    let hasPending = false;
    for (const [key] of this.pendingMessages) {
      if (this.hasPendingMessages(key)) {
        hasPending = true;
        break;
      }
    }

    if (!hasPending) {
      this.stopPendingMessageDelivery();
      return;
    }

    // Try to deliver pending messages for each agent
    for (const [key, pending] of this.pendingMessages) {
      if (pending.length === 0) continue;

      const agent = this.agents.get(key);
      if (!agent) {
        // Agent no longer exists, clear its pending messages
        this.pendingMessages.delete(key);
        continue;
      }

      // Check if agent is stable
      const isStable = await this.checkAgentStable(agent.port);
      if (!isStable) {
        continue; // Agent is busy, try again later
      }

      // Agent is stable, deliver the first pending message
      const message = pending.shift()!;
      console.log(`[Agent] Delivering buffered message to ${key} (${pending.length} remaining)`);

      try {
        await this.deliverMessageDirect(key, message.message);
      } catch (err) {
        // Put the message back at the front of the queue
        pending.unshift(message);
        console.error(`[Agent] Failed to deliver buffered message to ${key}:`, err);
      }
    }
  }

  private async checkAgentStable(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://localhost:${port}/status`);
      if (res.ok) {
        const data = await res.json();
        return data.status === "stable";
      }
    } catch {
      // Agent not reachable
    }
    return false;
  }

  private async deliverMessageDirect(key: string, message: string): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    // Check for duplicate message
    if (this.isDuplicateMessage(key, message)) {
      console.log(`[Agent] Skipping duplicate buffered message to ${key}`);
      return;
    }

    agent.status = "working";
    console.log(`[Agent] Sending buffered message to ${key} on port ${agent.port}`);

    const res = await fetch(`http://localhost:${agent.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, type: "user" }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Message send failed (${res.status}): ${text}`);
    }

    console.log(`[Agent] Buffered message sent successfully to ${key}`);
    this.cacheMessage(key, message);
    agent.status = "idle";
  }

  async acknowledgeIssue(issue: LinearIssue, apiKey?: string): Promise<void> {
    const name = this.config.agentName ?? "Amadeus";
    const message = `**🤖 ${name}:** I've received the issue. Beginning the planning process.`;
    console.log(`[Agent] Acknowledging issue ${issue.identifier}`);
    try {
      // Use realm-specific API key if provided
      const env = apiKey ? { ...process.env, LINEAR_API_KEY: apiKey } : process.env;
      await Bun.$`linear-cli comments create --body ${message} ${issue.identifier}`.env(env).quiet();
    } catch (err) {
      console.error(`[Agent] Failed to acknowledge issue ${issue.identifier}:`, err);
    }
  }

  async startAgent(issue: LinearIssue): Promise<void> {
    const key = this.getAgentKey(issue);

    // Look up project path: try project name first, then team key, then DEFAULT
    // Use lowercase for case-insensitive matching
    const projectName = issue.project?.name;
    const teamKey = issue.team?.key;
    const projectNameLower = projectName?.toLowerCase();
    const teamKeyLower = teamKey?.toLowerCase();
    const projectPath =
      (projectNameLower && this.config.projectPaths[projectNameLower]) ||
      (teamKeyLower && this.config.projectPaths[teamKeyLower]) ||
      this.config.projectPaths["default"] ||
      this.config.projectPaths["DEFAULT"];

    if (!projectPath) {
      const tried = [projectName, teamKey, "DEFAULT"].filter(Boolean).join(", ");
      console.error(`[Agent] No project path configured. Tried: ${tried}`);
      return;
    }

    const routedBy = projectNameLower && this.config.projectPaths[projectNameLower]
      ? `project "${projectName}"`
      : teamKeyLower && this.config.projectPaths[teamKeyLower]
        ? `team "${teamKey}"`
        : "DEFAULT";
    console.log(`[Agent] Routed ${issue.identifier} to ${projectPath} via ${routedBy}`);

    if (this.agents.has(key)) {
      console.log(`[Agent] Agent already exists: ${key}`);
      return;
    }

    await this.loadProfiles();
    let profile = this.getProfileForIssue(issue);

    // Resolve skill labels and merge skill profiles
    const activeSkills = resolveSkillLabels(issue, this.profiles);
    if (activeSkills.length > 0) {
      profile = mergeSkillProfiles(profile, activeSkills, this.profiles);
      console.log(`[Agent] Active skills: ${activeSkills.join(", ")}`);
    }

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

    // Apply profile configuration (MCP servers, permissions, skills)
    const configResult = await applyProfileConfig(workingDir, profile);
    if (!configResult.success) {
      console.warn(`[Agent] Failed to apply profile config: ${configResult.error}`);
    } else if (configResult.filesWritten.length > 0) {
      console.log(`[Agent] Applied profile config (${configResult.filesWritten.length} files)`);
    }

    // Get realm-specific API key for Linear access
    const realmInfo = teamKey ? getRealmByTeamKey(teamKey) : null;

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
        // Pass realm's Linear API key for MCP server authentication
        ...(realmInfo && { LINEAR_API_KEY: realmInfo.apiKey }),
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    this.agents.set(key, {
      process: proc,
      pid: proc.pid,
      port,
      projectPath,
      worktreePath,
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      linearState: issue.state?.name,
      activeSkills: activeSkills.length > 0 ? activeSkills : undefined,
      status: "starting",
      startedAt: new Date(),
    });

    // Set up exit handler for unexpected deaths
    this.setupExitHandler(key, proc, issue.id, issue.identifier);

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

    // Clear any stray characters in the input buffer (fixes agentapi "x" bug)
    await this.clearInputBuffer(agent.port);

    // Acknowledge the issue before starting the planning process
    await this.acknowledgeIssue(issue, realmInfo?.apiKey);

    // Get GitHub repo URL for file linking in comments
    const githubRepoUrl = await getGitHubRepoUrl(workingDir);

    // Download any Linear images in the description so Claude can access them
    let processedIssue = issue;
    if (issue.description && realmInfo?.apiKey) {
      const imagesDir = join(workingDir, ".amadeus-images");
      const result = await processDescription(issue.description, realmInfo.apiKey, imagesDir);
      if (result.downloadedCount > 0) {
        console.log(`[Agent] Downloaded ${result.downloadedCount} images for ${issue.identifier}`);
        processedIssue = { ...issue, description: result.processedDescription };
      }
      if (result.failedCount > 0) {
        console.warn(`[Agent] Failed to download ${result.failedCount} images for ${issue.identifier}`);
      }
    }

    await this.sendMessage(key, buildPrompt(processedIssue, profile, this.config.linearWorkspace, this.config.agentName, githubRepoUrl ?? undefined));
  }

  private setupExitHandler(
    key: string,
    proc: Subprocess,
    issueId: string,
    issueIdentifier: string
  ): void {
    proc.exited.then((exitCode) => {
      // Check if this was an intentional stop
      if (this.stoppingAgents.has(key)) {
        this.stoppingAgents.delete(key);
        return;
      }

      // This is an unexpected death
      const agent = this.agents.get(key);
      if (!agent) return; // Already removed

      console.log(`[Agent] Agent ${key} died unexpectedly with exit code ${exitCode}`);

      // Remove from agents map
      this.agents.delete(key);

      // Call the death handler if configured
      if (this.config.onAgentDeath) {
        const reason: AgentDeathInfo["reason"] =
          exitCode === 0 ? "exited" : exitCode === null ? "killed" : "crashed";

        this.config.onAgentDeath({
          key,
          issueId,
          issueIdentifier,
          exitCode,
          reason,
        });
      }
    });
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

    // Check for duplicate message
    if (this.isDuplicateMessage(key, message)) {
      console.log(`[Agent] Skipping duplicate message to ${key}`);
      return;
    }

    // Check if agent is stable immediately (single check, no waiting)
    const isStable = await this.checkAgentStable(agent.port);

    if (!isStable) {
      // Agent is busy, buffer the message for later delivery
      this.bufferMessage(key, message);
      return;
    }

    // Agent is stable, send immediately
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
        // Cache the message hash after successful send
        this.cacheMessage(key, message);
      }

      agent.status = "idle";
    } catch (err) {
      console.error(`[Agent] Failed to send message to ${key}:`, err);
      agent.status = "idle";
    }
  }

  private isDuplicateMessage(key: string, message: string): boolean {
    const hash = hashMessage(message);
    const now = Date.now();
    const entries = this.messageCache.get(key) ?? [];

    // Clean expired entries
    const validEntries = entries.filter(
      (e) => now - e.timestamp < MESSAGE_CACHE_TTL_MS
    );

    // Check for duplicate
    return validEntries.some((e) => e.hash === hash);
  }

  private cacheMessage(key: string, message: string): void {
    const hash = hashMessage(message);
    const now = Date.now();
    const entries = this.messageCache.get(key) ?? [];

    // Clean expired and add new entry
    const validEntries = entries
      .filter((e) => now - e.timestamp < MESSAGE_CACHE_TTL_MS)
      .slice(-MESSAGE_CACHE_MAX_SIZE + 1);

    validEntries.push({ hash, timestamp: now });
    this.messageCache.set(key, validEntries);
  }

  private async waitForStableStatus(port: number, maxAttempts = 60): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "stable") {
            return;
          }
        }
      } catch {
        // Not ready yet
      }
      await Bun.sleep(500);
    }
    console.warn(`[Agent] Agent on port ${port} never became stable, sending anyway`);
  }

  private async clearInputBuffer(port: number): Promise<void> {
    // Send Ctrl+U (ASCII 21) to clear the terminal input line
    // This fixes a bug where agentapi leaves stray characters (like "x") in the buffer
    try {
      await fetch(`http://localhost:${port}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "\x15", type: "user" }),
      });
      // Wait for agent to stabilize after the clear
      await this.waitForStableStatus(port, 10);
    } catch {
      // Ignore errors - this is a best-effort cleanup
    }
  }

  async stopAgent(key: string, completionReason?: CompletionReason): Promise<void> {
    const agent = this.agents.get(key);
    if (!agent) return;

    console.log(`[Agent] Stopping agent: ${key}${completionReason ? ` (reason: ${completionReason})` : ""}`);

    // Call completion callback before removing agent (only if reason provided)
    if (completionReason && this.config.onAgentComplete) {
      const duration = Date.now() - agent.startedAt.getTime();
      this.config.onAgentComplete({
        key,
        issueId: agent.linearIssueId,
        issueIdentifier: agent.issueIdentifier,
        issueTitle: agent.issueTitle,
        completionReason,
        finalLinearState: agent.linearState,
        duration,
      });
    }

    // Mark as intentionally stopping so exit handler doesn't fire death callback
    this.stoppingAgents.add(key);
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

    // Clean up message cache for this agent
    this.messageCache.delete(key);

    // Clean up pending messages for this agent
    this.clearPendingMessages(key);

    this.agents.delete(key);
  }
}

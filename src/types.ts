// ABOUTME: TypeScript interfaces for Linear webhook payloads and agent instances.
// ABOUTME: Defines the data structures used throughout the orchestrator.

import type { Subprocess } from "bun";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  state?: { id: string; name: string; type?: string };
  assignee?: { id: string };
  labels?: { name: string }[];
  team?: { key: string };
  project?: { id: string; name: string };
  trashed?: boolean;
}

export interface LinearComment {
  id: string;
  body: string;
  issueId: string;
  issue: LinearIssue;
  user?: { id: string; name: string };
  createdAt: string;
}

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment";
  data: LinearIssue | LinearComment;
  webhookTimestamp?: number;
}

export interface AgentInstance {
  process: Subprocess;
  pid?: number;
  port: number;
  projectPath: string;
  worktreePath?: string;
  linearIssueId: string;
  issueIdentifier: string;
  issueTitle: string;
  linearState?: string;
  activeSkills?: string[];
  status: "starting" | "idle" | "working";
  startedAt: Date;
}

export interface AgentStatus {
  key: string;
  pid?: number;
  port: number;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  linearState?: string;
  activeSkills?: string[];
  status: string;
  uptime: number;
  worktreePath?: string;
}

export type CompletionReason = "done" | "stopped" | "canceled" | "backlog";

export interface CompletedTask {
  key: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  completedAt: Date;
  completionReason: CompletionReason;
  finalLinearState?: string;
  duration: number; // milliseconds the task was active
}

export interface AgentProfileSkills {
  marketplaces?: string[];
  install?: string[];
  local?: string[];
}

export interface AgentProfile {
  extends?: string;
  mcpServers?: Record<string, McpServerConfig>;
  permissions?: { allow?: string[]; deny?: string[] };
  skills?: AgentProfileSkills;
  promptAdditions?: string[];
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

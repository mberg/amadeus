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
}

export interface AgentInstance {
  process: Subprocess;
  port: number;
  projectPath: string;
  worktreePath?: string;
  linearIssueId: string;
  issueIdentifier: string;
  status: "starting" | "idle" | "working";
  startedAt: Date;
}

export interface AgentStatus {
  key: string;
  port: number;
  issueId: string;
  issueIdentifier: string;
  status: string;
  uptime: number;
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

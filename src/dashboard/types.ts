// ABOUTME: TypeScript type definitions for the dashboard.
// ABOUTME: Defines Task (agent), Message, and configuration types.

export interface Task {
  key: string;
  port: number;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  linearState?: string;
  status: "idle" | "working" | "starting";
  uptime: number;
  worktreePath?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface DashboardConfig {
  linearWorkspace?: string;
}

export interface StatusResponse {
  agents: Task[];
  timestamp: string;
}

export interface MessagesResponse {
  messages: Message[];
}

export type LinearState =
  | "Planning"
  | "Building"
  | "Feedback Needed"
  | "Review"
  | "Done";

export type TaskStatus = "idle" | "working" | "starting";

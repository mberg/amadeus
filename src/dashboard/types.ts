// ABOUTME: TypeScript type definitions for the dashboard.
// ABOUTME: Defines Task (agent), Message, and configuration types.

export interface Task {
  key: string;
  pid?: number;
  port: number;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  linearProject?: string;
  linearState?: string;
  activeSkills?: string[];
  status: "idle" | "working" | "starting";
  uptime: number;
  worktreePath?: string;
  memoryMB?: number;
  machineName?: string;
  machineUrl?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface SetupProject {
  teamKey: string;
  linearProject?: string;
  path: string;
  profile?: string;
  githubRepoUrl?: string;
}

export interface SetupRealm {
  name: string;
  linearWorkspace: string;
  projects: SetupProject[];
}

export interface SetupGlobal {
  agentName: string;
  port: number;
  triggerStates: string[];
  useWorktrees: boolean;
  defaultProfile: string;
}

export interface SetupData {
  realms: SetupRealm[];
  global: SetupGlobal;
}

export type RuntimeMode = "standalone" | "hub" | "machine" | "sprite";

export interface DashboardConfig {
  linearWorkspace?: string;
  machineName?: string;
  runtimeMode?: RuntimeMode;
  setup?: SetupData | null;
}

export interface StatusResponse {
  agents: Task[];
  timestamp: string;
}

export interface MessagesResponse {
  messages: Message[];
}

export type CompletionReason = "done" | "stopped" | "canceled" | "backlog";

export interface CompletedTask {
  key: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  linearProject?: string;
  completedAt: string;
  completionReason: CompletionReason;
  finalLinearState?: string;
  duration: number;
}

export interface HistoryResponse {
  completedTasks: CompletedTask[];
  total: number;
  limit: number;
  offset: number;
}

export type LinearState =
  | "Planning"
  | "Building"
  | "Feedback Needed"
  | "Review"
  | "Done";

export type TaskStatus = "idle" | "working" | "starting";

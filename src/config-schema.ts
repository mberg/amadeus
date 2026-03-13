// ABOUTME: Zod schemas for validating Amadeus configuration.
// ABOUTME: Defines structure for realms, projects, and global settings.

import { z } from "zod";

/**
 * Schema for a project within a realm.
 * Maps a team key to a file path and optional profile.
 */
export const ProjectSchema = z.object({
  teamKey: z.string().min(1, "Team key cannot be empty"),
  linearProject: z.string().optional(), // Linear project name for routing (takes priority over teamKey)
  path: z.string().min(1, "Project path cannot be empty"),
  profile: z.string().optional(),
  githubRepoUrl: z.string().optional(),
  machineUrl: z.string().url().optional(), // Forward webhooks to this URL instead of spawning locally
});

export type Project = z.infer<typeof ProjectSchema>;

/**
 * Schema for a realm.
 * A realm groups a Linear workspace with its projects and credentials.
 */
export const RealmSchema = z.object({
  linearWorkspace: z.string().min(1, "Linear workspace cannot be empty"),
  apiKeyEnvVar: z.string().min(1, "API key env var name cannot be empty"),
  webhookSecretEnvVar: z.string().min(1, "Webhook secret env var name cannot be empty"),
  claudeBotUserId: z.string().optional(),
  projects: z.array(ProjectSchema).min(1, "At least one project required per realm"),
});

export type Realm = z.infer<typeof RealmSchema>;

/**
 * Schema for security settings.
 */
export const SecurityConfigSchema = z.object({
  enableAgentMessaging: z.boolean().default(false),
  publicDashboard: z.boolean().default(false), // Allow unauthenticated access to dashboard/status
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/**
 * Schema for multi-machine router configuration.
 */
export const RouterConfigSchema = z.object({
  url: z.string().url("Router URL must be a valid URL"),
  machineName: z.string().min(1, "Machine name cannot be empty"),
  secretEnvVar: z.string().min(1, "Router secret env var name cannot be empty"),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

/**
 * Runtime mode for the Amadeus server.
 * - 'standalone': Hub + Machine combined (default, for solo users)
 * - 'hub': Routing + aggregate dashboard only (no agent execution)
 * - 'machine': Agent execution + local dashboard only
 */
export const RuntimeModeSchema = z.enum(["standalone", "hub", "machine"]).default("standalone");

export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

/**
 * Schema for machine identity and settings.
 */
export const MachineConfigSchema = z.object({
  name: z.string().min(1, "Machine name cannot be empty"),
  token: z.string().optional(),
  hubUrl: z.string().url().optional(),
  heartbeat: z.boolean().default(false),
});

export type MachineConfig = z.infer<typeof MachineConfigSchema>;

/**
 * Schema for a static machine entry (for hub config).
 */
export const StaticMachineSchema = z.object({
  name: z.string().min(1, "Machine name cannot be empty"),
  url: z.string().url("Machine URL must be valid"),
  apiKey: z.string().optional(),
});

export type StaticMachine = z.infer<typeof StaticMachineSchema>;

/**
 * Schema for idle agent termination settings.
 */
export const IdleTerminationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMinutes: z.number().int().positive().default(15),
  idleStates: z.array(z.string()).default(["Needs Feedback"]),
  scanIntervalSeconds: z.number().int().positive().default(60),
});

/**
 * Schema for orchestrator agent settings.
 * The orchestrator agent actively monitors running agents via Linear API
 * to detect state drift, terminal transitions, and stalled agents.
 */
export const OrchestratorAgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  reconcileIntervalMs: z.number().int().positive().default(60000),
  stallTimeoutMs: z.number().int().positive().default(900000), // 15 minutes
  terminalStates: z.array(z.string()).default(["Done", "Closed", "Cancelled", "Canceled", "Duplicate"]),
  inactiveStates: z.array(z.string()).default(["Backlog", "Todo", "Triage"]),
});

export type OrchestratorAgentConfig = z.infer<typeof OrchestratorAgentConfigSchema>;

export type IdleTerminationConfig = z.infer<typeof IdleTerminationConfigSchema>;

/**
 * Schema for global configuration settings.
 */
export const AgentTypeSchema = z.enum(["claude", "codex"]).default("claude");

export const GlobalConfigSchema = z.object({
  port: z.number().int().positive().default(5678),
  agentName: z.string().default("Amadeus"),
  defaultAgentType: AgentTypeSchema,
  triggerStates: z.array(z.string()).default(["Planning"]),
  useWorktrees: z.boolean().default(true),
  worktreesDir: z.string().optional(),
  profilesDir: z.string().default("./agent-profiles"),
  defaultProfile: z.string().default("base"),
  dbPath: z.string().default("./amadeus-agents.db"),
  healthCheckIntervalMs: z.number().int().positive().default(30000),
  healthCheckTimeoutMs: z.number().int().positive().default(5000),
  disablePRCheck: z.boolean().default(false), // Disable periodic PR merge checking
  security: SecurityConfigSchema.optional().default({ enableAgentMessaging: false, publicDashboard: false }),
  router: RouterConfigSchema.optional(),
  runtimeMode: RuntimeModeSchema,
  machine: MachineConfigSchema.optional(),
  machines: z.array(StaticMachineSchema).optional(),
  idleTermination: IdleTerminationConfigSchema.optional().default({
    enabled: true,
    timeoutMinutes: 15,
    idleStates: ["Needs Feedback"],
    scanIntervalSeconds: 60,
  }),
  orchestratorAgent: OrchestratorAgentConfigSchema.optional().default({
    enabled: true,
    reconcileIntervalMs: 60000,
    stallTimeoutMs: 900000,
    terminalStates: ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"],
    inactiveStates: ["Backlog", "Todo", "Triage"],
  }),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/**
 * Complete configuration schema for amadeus.config.yaml.
 */
export const AmadeusConfigSchema = z.object({
  realms: z.record(z.string(), RealmSchema).default({}),
  global: GlobalConfigSchema,
});

export type AmadeusConfig = z.infer<typeof AmadeusConfigSchema>;

/**
 * Resolved router configuration with secret value.
 */
export interface ResolvedRouterConfig {
  url: string;
  machineName: string;
  secret: string;
}

/**
 * Resolved configuration with actual secret values.
 * This is what the application uses after loading and resolving env vars.
 */
export interface ResolvedRealm {
  name: string;
  linearWorkspace: string;
  apiKey: string;
  webhookSecret: string;
  claudeBotUserId?: string;
  promptTemplate?: string;
  projects: Project[];
}

export interface ResolvedConfig {
  realms: ResolvedRealm[];
  global: GlobalConfig;
  router?: ResolvedRouterConfig;
  machines?: Array<{ name: string; url: string; apiKey?: string }>;
  // Convenience lookups
  realmByWorkspace: Map<string, ResolvedRealm>;
  realmByTeamKey: Map<string, ResolvedRealm>;
  projectByTeamKey: Map<string, { realm: ResolvedRealm; project: Project }>;
}

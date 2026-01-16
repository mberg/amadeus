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
});

export type Project = z.infer<typeof ProjectSchema>;

/**
 * Schema for a Linear realm.
 * Groups a Linear workspace with its projects and credentials.
 */
export const LinearRealmSchema = z.object({
  type: z.literal("linear").default("linear"),
  linearWorkspace: z.string().min(1, "Linear workspace cannot be empty"),
  apiKeyEnvVar: z.string().min(1, "API key env var name cannot be empty"),
  webhookSecretEnvVar: z.string().min(1, "Webhook secret env var name cannot be empty"),
  claudeBotUserId: z.string().optional(),
  projects: z.array(ProjectSchema).min(1, "At least one project required per realm"),
});

export type LinearRealm = z.infer<typeof LinearRealmSchema>;

/**
 * Schema for a GitHub realm.
 * Groups a GitHub repository with its projects and credentials.
 */
export const GitHubRealmSchema = z.object({
  type: z.literal("github"),
  owner: z.string().min(1, "GitHub owner cannot be empty"),
  repo: z.string().min(1, "GitHub repo cannot be empty"),
  projectNumber: z.number().int().positive().optional(), // GitHub Projects number (optional - falls back to labels)
  tokenEnvVar: z.string().min(1, "Token env var name cannot be empty"),
  webhookSecretEnvVar: z.string().min(1, "Webhook secret env var name cannot be empty"),
  botUserId: z.string().optional(),
  projects: z.array(ProjectSchema).min(1, "At least one project required per realm"),
});

export type GitHubRealm = z.infer<typeof GitHubRealmSchema>;

/**
 * Schema for a realm (Linear or GitHub).
 */
export const RealmSchema = z.discriminatedUnion("type", [
  LinearRealmSchema,
  GitHubRealmSchema,
]);

export type Realm = z.infer<typeof RealmSchema>;

/**
 * Schema that accepts either new typed realms or legacy Linear-only realms.
 * Uses preprocessing to add default type for backward compatibility.
 */
export const FlexibleRealmSchema = z.preprocess(
  (data) => {
    // Add default type "linear" if not specified and linearWorkspace is present
    if (
      typeof data === "object" &&
      data !== null &&
      !("type" in data) &&
      "linearWorkspace" in data
    ) {
      return { ...data, type: "linear" };
    }
    return data;
  },
  RealmSchema
);

/**
 * Schema for security settings.
 */
export const SecurityConfigSchema = z.object({
  enableAgentMessaging: z.boolean().default(false),
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
 * Schema for global configuration settings.
 */
export const GlobalConfigSchema = z.object({
  port: z.number().int().positive().default(5678),
  agentName: z.string().default("Amadeus"),
  triggerStates: z.array(z.string()).default(["Planning"]),
  useWorktrees: z.boolean().default(true),
  worktreesDir: z.string().optional(),
  profilesDir: z.string().default("./agent-profiles"),
  defaultProfile: z.string().default("base"),
  dbPath: z.string().default("./amadeus-agents.db"),
  healthCheckIntervalMs: z.number().int().positive().default(30000),
  healthCheckTimeoutMs: z.number().int().positive().default(5000),
  security: SecurityConfigSchema.optional().default({ enableAgentMessaging: false }),
  router: RouterConfigSchema.optional(),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/**
 * Complete configuration schema for amadeus.config.yaml.
 */
export const AmadeusConfigSchema = z.object({
  realms: z.record(z.string(), FlexibleRealmSchema).refine(
    (realms) => Object.keys(realms).length > 0,
    "At least one realm must be defined"
  ),
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
 * Resolved Linear realm with actual secret values.
 */
export interface ResolvedLinearRealm {
  type: "linear";
  name: string;
  linearWorkspace: string;
  apiKey: string;
  webhookSecret: string;
  claudeBotUserId?: string;
  projects: Project[];
}

/**
 * Resolved GitHub realm with actual secret values.
 */
export interface ResolvedGitHubRealm {
  type: "github";
  name: string;
  owner: string;
  repo: string;
  projectNumber?: number;
  token: string;
  webhookSecret: string;
  botUserId?: string;
  projects: Project[];
}

/**
 * Resolved realm (Linear or GitHub) with actual secret values.
 */
export type ResolvedRealm = ResolvedLinearRealm | ResolvedGitHubRealm;

/**
 * Type guard for Linear realms.
 */
export function isLinearRealm(realm: ResolvedRealm): realm is ResolvedLinearRealm {
  return realm.type === "linear";
}

/**
 * Type guard for GitHub realms.
 */
export function isGitHubRealm(realm: ResolvedRealm): realm is ResolvedGitHubRealm {
  return realm.type === "github";
}

export interface ResolvedConfig {
  realms: ResolvedRealm[];
  global: GlobalConfig;
  router?: ResolvedRouterConfig;
  // Convenience lookups
  realmByWorkspace: Map<string, ResolvedRealm>;
  realmByTeamKey: Map<string, ResolvedRealm>;
  projectByTeamKey: Map<string, { realm: ResolvedRealm; project: Project }>;
}

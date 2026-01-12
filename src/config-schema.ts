// ABOUTME: Zod schemas for validating Amadeus configuration.
// ABOUTME: Defines structure for realms, projects, and global settings.

import { z } from "zod";

/**
 * Schema for a project within a realm.
 * Maps a team key to a file path and optional profile.
 */
export const ProjectSchema = z.object({
  teamKey: z.string().min(1, "Team key cannot be empty"),
  path: z.string().min(1, "Project path cannot be empty"),
  profile: z.string().optional(),
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
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/**
 * Complete configuration schema for amadeus.config.yaml.
 */
export const AmadeusConfigSchema = z.object({
  realms: z.record(z.string(), RealmSchema).refine(
    (realms) => Object.keys(realms).length > 0,
    "At least one realm must be defined"
  ),
  global: GlobalConfigSchema.default({}),
});

export type AmadeusConfig = z.infer<typeof AmadeusConfigSchema>;

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
  projects: Project[];
}

export interface ResolvedConfig {
  realms: ResolvedRealm[];
  global: GlobalConfig;
  // Convenience lookups
  realmByWorkspace: Map<string, ResolvedRealm>;
  realmByTeamKey: Map<string, ResolvedRealm>;
  projectByTeamKey: Map<string, { realm: ResolvedRealm; project: Project }>;
}

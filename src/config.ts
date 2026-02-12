// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Supports both new YAML-based config and legacy env-based config.

import { join, resolve } from "node:path";
import {
  loadConfig,
  loadConfigFromYaml,
  hasNewStyleConfig,
  writeConfig,
  getConfigYaml as getConfigYamlFromFile,
  validateConfigYaml,
  type ResolvedConfig,
  type ResolvedRealm,
  type ConfigValidationResult,
} from "./config-loader";
import type { SecurityConfig, RuntimeMode, GlobalConfig, Project } from "./config-schema";
import { GlobalConfigSchema } from "./config-schema";
import yaml from "js-yaml";
import {
  migrate,
  ensureOrg,
  getConfigYaml as dbGetConfigYaml,
  saveConfigYaml as dbSaveConfigYaml,
  getSecret,
  setSecret,
  getRealmsByOrg,
  getProjectsByRealm,
  createRealm,
  createProject,
} from "./db";
import type { DbRealm } from "./db/realms";

/**
 * Legacy CONFIG interface for backward compatibility.
 * New code should use REALM_CONFIG for multi-realm support.
 */
export interface LegacyConfig {
  port: number;
  apiToken?: string;
  agentName: string;
  linearWebhookSecret: string;
  claudeBotUserId?: string;
  projectPaths: Record<string, string>;
  triggerStates: string[];
  profilesDir: string;
  defaultProfile: string;
  teamProfiles: Record<string, string>;
  useWorktrees: boolean;
  worktreesDir?: string;
  linearWorkspace?: string;
  dbPath: string;
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  disablePRCheck: boolean;
  notificationEmail?: string;
  resendApiKey?: string;
  notificationFromEmail: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

function loadProjectPathsFromEnv(): Record<string, string> {
  const paths: Record<string, string> = {};
  const pathsEnv = process.env.PROJECT_PATHS;

  if (pathsEnv) {
    for (const mapping of pathsEnv.split(",")) {
      const [key, path] = mapping.split(":");
      if (key && path) {
        paths[key.trim()] = path.trim();
      }
    }
  }

  if (Object.keys(paths).length === 0) {
    paths.DEFAULT = process.env.DEFAULT_PROJECT_PATH ?? "/tmp/amadeus-default";
  }

  return paths;
}

function loadTeamProfilesFromEnv(): Record<string, string> {
  const teamProfiles: Record<string, string> = {};
  const profilesEnv = process.env.TEAM_PROFILES;

  if (profilesEnv) {
    for (const mapping of profilesEnv.split(",")) {
      const [team, profile] = mapping.split(":");
      if (team && profile) {
        teamProfiles[team.trim()] = profile.trim();
      }
    }
  }

  return teamProfiles;
}

/**
 * Build legacy CONFIG from new-style resolved config.
 * Uses the first realm for single-realm backward compatibility.
 */
function buildLegacyConfigFromResolved(resolved: ResolvedConfig): LegacyConfig {
  const firstRealm = resolved.realms[0];

  // Build project paths from all realms
  // Linear project name takes priority over team key for routing
  // Keys are stored lowercase for case-insensitive matching
  const projectPaths: Record<string, string> = {};
  for (const realm of resolved.realms) {
    for (const project of realm.projects) {
      // Add by Linear project name if specified (takes priority)
      if (project.linearProject) {
        projectPaths[project.linearProject.toLowerCase()] = project.path;
      }
      // Also add by team key as fallback
      projectPaths[project.teamKey.toLowerCase()] = project.path;
    }
  }

  // Build team profiles from all realms
  const teamProfiles: Record<string, string> = {};
  for (const realm of resolved.realms) {
    for (const project of realm.projects) {
      if (project.profile) {
        teamProfiles[project.teamKey] = project.profile;
      }
    }
  }

  // Resolve profilesDir relative to project root
  const baseDir = resolve(import.meta.dir, "..");
  const profilesDir = resolved.global.profilesDir.startsWith("./")
    ? join(baseDir, resolved.global.profilesDir)
    : resolved.global.profilesDir;

  const dbPath = resolved.global.dbPath.startsWith("./")
    ? join(baseDir, resolved.global.dbPath)
    : resolved.global.dbPath;

  return {
    port: resolved.global.port,
    apiToken: process.env.AMADEUS_API_TOKEN,
    agentName: resolved.global.agentName,
    linearWebhookSecret: firstRealm.webhookSecret,
    claudeBotUserId: firstRealm.claudeBotUserId,
    projectPaths,
    triggerStates: resolved.global.triggerStates,
    profilesDir,
    defaultProfile: resolved.global.defaultProfile,
    teamProfiles,
    useWorktrees: resolved.global.useWorktrees,
    worktreesDir: resolved.global.worktreesDir,
    linearWorkspace: firstRealm.linearWorkspace,
    dbPath,
    healthCheckIntervalMs: resolved.global.healthCheckIntervalMs,
    healthCheckTimeoutMs: resolved.global.healthCheckTimeoutMs,
    disablePRCheck: resolved.global.disablePRCheck,
    notificationEmail: process.env.NOTIFICATION_EMAIL,
    resendApiKey: process.env.RESEND_API_KEY,
    notificationFromEmail: process.env.NOTIFICATION_FROM_EMAIL ?? "amadeus@resend.dev",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
  };
}

/**
 * Load legacy CONFIG from environment variables.
 */
function loadLegacyConfigFromEnv(): LegacyConfig {
  console.warn(
    "[Config] ⚠️  Using legacy environment-based configuration.\n" +
    "         Create amadeus.config.yaml for the recommended config approach.\n" +
    "         See amadeus.config.example.yaml for the format."
  );

  return {
    port: Number(process.env.PORT) || 5678,
    apiToken: process.env.AMADEUS_API_TOKEN,
    agentName: process.env.AGENT_NAME ?? "Amadeus",
    linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? "",
    claudeBotUserId: process.env.CLAUDE_BOT_USER_ID,
    projectPaths: loadProjectPathsFromEnv(),
    triggerStates: (process.env.TRIGGER_STATES ?? "Planning").split(","),
    profilesDir: process.env.PROFILES_DIR ?? join(import.meta.dir, "..", "agent-profiles"),
    defaultProfile: process.env.DEFAULT_PROFILE ?? "base",
    teamProfiles: loadTeamProfilesFromEnv(),
    useWorktrees: process.env.USE_WORKTREES !== "false",
    worktreesDir: process.env.WORKTREES_DIR,
    linearWorkspace: process.env.LINEAR_WORKSPACE,
    dbPath: process.env.DB_PATH ?? join(import.meta.dir, "..", "amadeus-agents.db"),
    healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS) || 30000,
    healthCheckTimeoutMs: Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 5000,
    disablePRCheck: process.env.DISABLE_PR_CHECK === "true",
    notificationEmail: process.env.NOTIFICATION_EMAIL,
    resendApiKey: process.env.RESEND_API_KEY,
    notificationFromEmail: process.env.NOTIFICATION_FROM_EMAIL ?? "amadeus@resend.dev",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
  };
}

/**
 * Resolved realm configuration for multi-realm support.
 * Only available when using new-style config (amadeus.config.yaml).
 */
export let REALM_CONFIG: ResolvedConfig | null = null;

/**
 * Legacy CONFIG export for backward compatibility.
 * Works with both new and legacy config formats.
 */
export let CONFIG: LegacyConfig;

let _configInitialized = false;

/**
 * Parse global settings from the YAML stored in organizations.config_yaml.
 * Returns defaults if no YAML exists or if parsing fails.
 */
function parseGlobalConfig(yamlContent: string | null): GlobalConfig {
  if (!yamlContent) {
    return GlobalConfigSchema.parse({});
  }
  try {
    const raw = yaml.load(yamlContent) as Record<string, unknown> | null;
    return GlobalConfigSchema.parse(raw?.global ?? {});
  } catch {
    return GlobalConfigSchema.parse({});
  }
}

/**
 * Build ResolvedConfig from DB realms + secrets + global YAML config.
 * Returns null if no DB realms exist.
 */
async function buildRealmConfigFromDb(orgId: string): Promise<ResolvedConfig | null> {
  const dbRealms = await getRealmsByOrg(orgId);
  if (dbRealms.length === 0) return null;

  const yamlContent = await dbGetConfigYaml(orgId);
  const global = parseGlobalConfig(yamlContent);

  const resolvedRealms: ResolvedRealm[] = [];
  const realmByWorkspace = new Map<string, ResolvedRealm>();
  const realmByTeamKey = new Map<string, ResolvedRealm>();
  const projectByTeamKey = new Map<string, { realm: ResolvedRealm; project: Project }>();

  for (const dbRealm of dbRealms) {
    const apiKey = await getSecret(orgId, `realm:${dbRealm.id}:linear_api_key`) ?? "";
    const webhookSecret = await getSecret(orgId, `realm:${dbRealm.id}:webhook_secret`) ?? "";

    const dbProjects = await getProjectsByRealm(dbRealm.id);
    const projects: Project[] = dbProjects
      .filter((p) => p.linearTeamKey)
      .map((p) => ({
        teamKey: p.linearTeamKey!,
        linearProject: p.linearProjectName ?? undefined,
        path: "/",
        githubRepoUrl: p.githubRepoUrl ?? undefined,
      }));

    const resolvedRealm: ResolvedRealm = {
      name: dbRealm.name,
      linearWorkspace: dbRealm.linearWorkspace,
      apiKey,
      webhookSecret,
      claudeBotUserId: dbRealm.claudeBotUserId ?? undefined,
      projects,
    };

    resolvedRealms.push(resolvedRealm);
    realmByWorkspace.set(dbRealm.linearWorkspace, resolvedRealm);

    for (const project of projects) {
      realmByTeamKey.set(project.teamKey, resolvedRealm);
      projectByTeamKey.set(project.teamKey, { realm: resolvedRealm, project });
    }
  }

  return {
    realms: resolvedRealms,
    global,
    realmByWorkspace,
    realmByTeamKey,
    projectByTeamKey,
  };
}

/**
 * Seed DB realms from a parsed YAML config (one-time migration).
 * Creates realm rows and stores resolved secrets.
 */
async function seedRealmsFromYaml(orgId: string, config: ResolvedConfig): Promise<void> {
  for (const realm of config.realms) {
    const dbRealm = await createRealm({
      orgId,
      name: realm.name,
      linearWorkspace: realm.linearWorkspace,
      claudeBotUserId: realm.claudeBotUserId,
    });

    if (realm.apiKey) {
      await setSecret(orgId, `realm:${dbRealm.id}:linear_api_key`, realm.apiKey);
    }
    if (realm.webhookSecret) {
      await setSecret(orgId, `realm:${dbRealm.id}:webhook_secret`, realm.webhookSecret);
    }

    // Create DB projects for each realm project that has a team key
    for (const project of realm.projects) {
      await createProject({
        orgId,
        name: project.linearProject ?? project.teamKey,
        linearTeamKey: project.teamKey,
        linearProjectName: project.linearProject,
        githubRepoUrl: project.githubRepoUrl,
        realmId: dbRealm.id,
      });
    }

    console.log(`[Config] Seeded realm "${realm.name}" with ${realm.projects.length} project(s)`);
  }
}

/**
 * Rebuild in-memory REALM_CONFIG from DB after realm API changes.
 */
export async function rebuildRealmConfig(orgId: string = "default"): Promise<void> {
  const dbConfig = await buildRealmConfigFromDb(orgId);
  if (dbConfig) {
    REALM_CONFIG = dbConfig;
    CONFIG = buildLegacyConfigFromResolved(dbConfig);
    console.log(`[Config] Rebuilt config with ${dbConfig.realms.length} realm(s) from database`);
  }
}

/**
 * Initialize configuration from Postgres.
 * Falls back to local YAML file (seeding Postgres) or legacy env config.
 * Must be called before using CONFIG or REALM_CONFIG.
 */
export async function initConfig(orgId: string = "default"): Promise<void> {
  // Run Postgres migration and ensure org exists
  await migrate();
  await ensureOrg(orgId);

  // Try DB realms first
  const dbConfig = await buildRealmConfigFromDb(orgId);
  if (dbConfig) {
    REALM_CONFIG = dbConfig;
    CONFIG = buildLegacyConfigFromResolved(dbConfig);
    console.log(`[Config] Loaded ${dbConfig.realms.length} realm(s) from database`);
    _configInitialized = true;
    return;
  }

  // Try Postgres YAML config
  let yamlContent = await dbGetConfigYaml(orgId);

  // If no config in Postgres, seed from local YAML file
  if (!yamlContent) {
    const localYaml = getConfigYamlFromFile();
    if (localYaml) {
      yamlContent = localYaml;
      await dbSaveConfigYaml(orgId, yamlContent);
      console.log("[Config] Seeded Postgres from local config file");
    }
  }

  if (yamlContent) {
    REALM_CONFIG = loadConfigFromYaml(yamlContent);
    CONFIG = buildLegacyConfigFromResolved(REALM_CONFIG);
    console.log(`[Config] Loaded ${REALM_CONFIG.realms.length} realm(s) from YAML config`);

    // Seed DB realms from YAML for future DB-first loading
    await seedRealmsFromYaml(orgId, REALM_CONFIG);
  } else {
    CONFIG = loadLegacyConfigFromEnv();
  }

  _configInitialized = true;
}

/**
 * Check if multi-realm configuration is active.
 */
export function isMultiRealmConfig(): boolean {
  return REALM_CONFIG !== null;
}

/**
 * Get all webhook secrets for verification (tries each realm).
 * Returns array of { secret, realm } for verification.
 */
export function getAllWebhookSecrets(): Array<{ secret: string; realmName: string }> {
  if (REALM_CONFIG) {
    return REALM_CONFIG.realms.map((r: ResolvedRealm) => ({
      secret: r.webhookSecret,
      realmName: r.name,
    }));
  }
  // Legacy: single secret
  return [{ secret: CONFIG.linearWebhookSecret, realmName: "default" }];
}

/**
 * Get realm by team key (for routing issues to correct API key).
 */
export function getRealmByTeamKey(teamKey: string): {
  apiKey: string;
  workspace: string;
  realmName: string;
} | null {
  if (!REALM_CONFIG) return null;

  const realm = REALM_CONFIG.realmByTeamKey.get(teamKey);
  if (!realm) return null;

  return {
    apiKey: realm.apiKey,
    workspace: realm.linearWorkspace,
    realmName: realm.name,
  };
}

/**
 * Get current security configuration.
 */
export function getSecurityConfig(): SecurityConfig {
  if (REALM_CONFIG) {
    return REALM_CONFIG.global.security;
  }
  return { enableAgentMessaging: false, publicDashboard: false };
}

/**
 * Get router configuration if configured.
 */
export function getRouterConfig(): { url: string; machineName: string; secret: string } | null {
  if (REALM_CONFIG?.router) {
    return REALM_CONFIG.router;
  }
  return null;
}

/**
 * Get the current runtime mode.
 */
export function getRuntimeMode(): RuntimeMode {
  if (REALM_CONFIG) {
    return REALM_CONFIG.global.runtimeMode;
  }
  return "standalone";
}

/**
 * Check if running in hub mode (routing + aggregate dashboard only).
 */
export function isHubMode(): boolean {
  return getRuntimeMode() === "hub";
}

/**
 * Check if running in machine mode (agent execution + local dashboard only).
 */
export function isMachineMode(): boolean {
  return getRuntimeMode() === "machine";
}

/**
 * Check if running in standalone mode (hub + machine combined).
 */
export function isStandaloneMode(): boolean {
  return getRuntimeMode() === "standalone";
}

/**
 * Get machine configuration with defaults.
 */
export function getMachineConfig(): { name: string; token?: string; hubUrl?: string; heartbeat: boolean } {
  if (REALM_CONFIG?.global.machine) {
    return REALM_CONFIG.global.machine;
  }
  // Default machine config for standalone/legacy mode
  return {
    name: process.env.HOSTNAME ?? "Local",
    heartbeat: false,
  };
}

/**
 * Get the effective server port.
 * PORT env var takes precedence over config, allowing platforms like Railway
 * to assign the port dynamically. Falls back to config port (default 5678).
 */
export function getServerPort(): number {
  const portEnv = process.env.PORT;
  if (portEnv) {
    const port = parseInt(portEnv, 10);
    if (!isNaN(port) && port > 0) {
      return port;
    }
  }
  return CONFIG.port;
}

/**
 * Get machine URL for a project, checking by Linear project name first, then team key.
 * Returns the URL to forward webhooks to, or null for local processing.
 */
export function getMachineUrlForProject(projectName: string | undefined, teamKey: string | undefined): string | null {
  if (!REALM_CONFIG) return null;

  // Search all realms for a matching project
  for (const realm of REALM_CONFIG.realms) {
    for (const project of realm.projects) {
      // Match by Linear project name (case-insensitive)
      if (projectName && project.linearProject?.toLowerCase() === projectName.toLowerCase()) {
        return project.machineUrl ?? null;
      }
    }
  }

  // Fall back to team key lookup
  if (teamKey) {
    const entry = REALM_CONFIG.projectByTeamKey.get(teamKey);
    return entry?.project.machineUrl ?? null;
  }

  return null;
}

export { validateConfigYaml };

/**
 * Get the raw YAML configuration content from Postgres.
 */
export function getConfigYaml(orgId: string = "default"): Promise<string | null> {
  return dbGetConfigYaml(orgId);
}

export type ReloadConfigResult =
  | { success: true; config: ResolvedConfig }
  | { success: false; errors: string[] };

/**
 * Reload configuration: validate, save to Postgres, and update in-memory config.
 * Only works with new-style YAML config.
 */
export function reloadConfig(yamlContent: string, orgId: string = "default"): ReloadConfigResult {
  if (!REALM_CONFIG) {
    return { success: false, errors: ["Config reload only supported with YAML config"] };
  }

  const validation = validateConfigYaml(yamlContent);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  REALM_CONFIG = validation.config;
  CONFIG = buildLegacyConfigFromResolved(validation.config);

  // Save to Postgres (fire and forget — in-memory is already updated)
  dbSaveConfigYaml(orgId, yamlContent).catch((err) => {
    console.error("[Config] Failed to persist config to database:", err);
  });

  console.log(`[Config] Reloaded configuration with ${validation.config.realms.length} realm(s)`);
  return { success: true, config: validation.config };
}

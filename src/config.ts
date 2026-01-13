// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Supports both new YAML-based config and legacy env-based config.

import { join, resolve } from "node:path";
import {
  loadConfig,
  hasNewStyleConfig,
  type ResolvedConfig,
  type ResolvedRealm,
} from "./config-loader";

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
  notificationEmail?: string;
  resendApiKey?: string;
  notificationFromEmail: string;
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
  const projectPaths: Record<string, string> = {};
  for (const realm of resolved.realms) {
    for (const project of realm.projects) {
      projectPaths[project.teamKey] = project.path;
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
    notificationEmail: process.env.NOTIFICATION_EMAIL,
    resendApiKey: process.env.RESEND_API_KEY,
    notificationFromEmail: process.env.NOTIFICATION_FROM_EMAIL ?? "amadeus@resend.dev",
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
    notificationEmail: process.env.NOTIFICATION_EMAIL,
    resendApiKey: process.env.RESEND_API_KEY,
    notificationFromEmail: process.env.NOTIFICATION_FROM_EMAIL ?? "amadeus@resend.dev",
  };
}

// Determine which config system to use
const useNewConfig = hasNewStyleConfig();

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

if (useNewConfig) {
  try {
    REALM_CONFIG = loadConfig();
    CONFIG = buildLegacyConfigFromResolved(REALM_CONFIG);
    console.log(`[Config] Loaded ${REALM_CONFIG.realms.length} realm(s) from amadeus.config.yaml`);
  } catch (error) {
    console.error("[Config] Failed to load amadeus.config.yaml:", error);
    process.exit(1);
  }
} else {
  CONFIG = loadLegacyConfigFromEnv();
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

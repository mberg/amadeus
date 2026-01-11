// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Loads environment variables and defines project path mappings.

import { join } from "node:path";

function loadProjectPaths(): Record<string, string> {
  const paths: Record<string, string> = {};

  // Load from PROJECT_PATHS env var (format: "TEAM1:/path1,TEAM2:/path2")
  const pathsEnv = process.env.PROJECT_PATHS;
  if (pathsEnv) {
    for (const mapping of pathsEnv.split(",")) {
      const [key, path] = mapping.split(":");
      if (key && path) {
        paths[key.trim()] = path.trim();
      }
    }
  }

  // Fallback default
  if (Object.keys(paths).length === 0) {
    paths.DEFAULT = process.env.DEFAULT_PROJECT_PATH ?? "/tmp/amadeus-default";
  }

  return paths;
}

function loadTeamProfiles(): Record<string, string> {
  const teamProfiles: Record<string, string> = {};

  // Load from TEAM_PROFILES env var (format: "TEAM1:profile1,TEAM2:profile2")
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

export const CONFIG = {
  port: Number(process.env.PORT) || 5678,
  linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? "",
  claudeBotUserId: process.env.CLAUDE_BOT_USER_ID,
  projectPaths: loadProjectPaths(),
  triggerStates: (process.env.TRIGGER_STATES ?? "Planning,Ready to Build").split(","),
  profilesDir: process.env.PROFILES_DIR ?? join(import.meta.dir, "..", "agent-profiles"),
  defaultProfile: process.env.DEFAULT_PROFILE ?? "base",
  teamProfiles: loadTeamProfiles(),
  useWorktrees: process.env.USE_WORKTREES !== "false",
  worktreesDir: process.env.WORKTREES_DIR,
  linearWorkspace: process.env.LINEAR_WORKSPACE,
  // Health monitoring and persistence
  dbPath: process.env.DB_PATH ?? join(import.meta.dir, "..", "amadeus-agents.db"),
  healthCheckIntervalMs: Number(process.env.HEALTH_CHECK_INTERVAL_MS) || 30000,
  healthCheckTimeoutMs: Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 5000,
  // Email notifications
  notificationEmail: process.env.NOTIFICATION_EMAIL,
  resendApiKey: process.env.RESEND_API_KEY,
  notificationFromEmail: process.env.NOTIFICATION_FROM_EMAIL ?? "amadeus@resend.dev",
};

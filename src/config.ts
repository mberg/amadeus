// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Loads environment variables and defines project path mappings.

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

export const CONFIG = {
  port: Number(process.env.PORT) || 5678,
  linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? "",
  claudeBotUserId: process.env.CLAUDE_BOT_USER_ID,
  projectPaths: loadProjectPaths(),
  triggerStates: (process.env.TRIGGER_STATES ?? "Scoping,Ready to Build").split(","),
};

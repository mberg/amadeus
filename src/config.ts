// ABOUTME: Configuration for the orchestrator server.
// ABOUTME: Loads environment variables and defines project path mappings.

export const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  linearWebhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? "",
  claudeBotUserId: process.env.CLAUDE_BOT_USER_ID,

  // Map Linear team keys to local project paths
  projectPaths: {
    DEFAULT: process.env.DEFAULT_PROJECT_PATH ?? "/tmp/amadeus-default",
  } as Record<string, string>,

  // Workflow states that trigger agent spawn
  triggerStates: ["Scoping", "Ready to Build"],
};

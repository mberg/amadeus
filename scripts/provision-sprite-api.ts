// ABOUTME: Script to provision a Sprite VM for running Amadeus via API.
// ABOUTME: Uses the @fly/sprites SDK for remote command execution.

import { SpritesClient } from "@fly/sprites";

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;
if (!SPRITES_TOKEN) {
  console.error("SPRITES_TOKEN environment variable not set");
  process.exit(1);
}

const spriteName = process.argv[2];
const projectRepoUrl = process.argv[3]; // Optional: GitHub repo URL for the project

if (!spriteName) {
  console.error("Usage: bun scripts/provision-sprite-api.ts <sprite-name> [project-repo-url]");
  console.error("");
  console.error("Examples:");
  console.error("  bun scripts/provision-sprite-api.ts amadeus-zonewise https://github.com/mberg/timehopper");
  console.error("  bun scripts/provision-sprite-api.ts amadeus-ona");
  process.exit(1);
}

const client = new SpritesClient(SPRITES_TOKEN);
const sprite = client.sprite(spriteName);

// SSH keys for GitHub access - read from environment variables
const SSH_PRIVATE_KEY = process.env.SPRITE_SSH_PRIVATE_KEY;
const SSH_PUBLIC_KEY = process.env.SPRITE_SSH_PUBLIC_KEY;

const SSH_CONFIG = `Host github.com
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  IdentityFile ~/.ssh/id_ed25519`;

// Sprite config template
const SPRITE_CONFIG_TEMPLATE = `# Sprite-specific Amadeus configuration
# Edit realm/project settings for your setup

realms:
  main:
    linearWorkspace: your-workspace
    apiKeyEnvVar: LINEAR_API_KEY
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET
    projects:
      - teamKey: TEAM
        path: /home/sprite/projects/your-project
        profile: base

global:
  runtimeMode: sprite
  port: 8080
  agentName: Amadeus
  triggerStates:
    - Planning
  useWorktrees: true
  worktreesDir: /home/sprite/.amadeus-worktrees
  profilesDir: ./agent-profiles
  defaultProfile: base
  dbPath: ./amadeus-agents.db
`;

// Environment variables to forward to the sprite's .env file
const ENV_VARS_TO_FORWARD = [
  "LINEAR_API_KEY",
  "LINEAR_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "AMADEUS_API_TOKEN",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
];

function buildEnvFileContent(): string {
  const lines: string[] = [];
  for (const varName of ENV_VARS_TO_FORWARD) {
    const value = process.env[varName];
    if (value) {
      lines.push(`${varName}=${value}`);
    }
  }
  return lines.join("\n");
}

async function run(cmd: string): Promise<string> {
  console.log(`\n> ${cmd}`);
  const { stdout, stderr } = await sprite.execFile("bash", ["-c", cmd]);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

async function tryRun(cmd: string): Promise<{ success: boolean; stdout: string }> {
  try {
    const stdout = await run(cmd);
    return { success: true, stdout };
  } catch {
    return { success: false, stdout: "" };
  }
}

async function main() {
  const totalSteps = projectRepoUrl ? 13 : 12;
  let step = 0;

  console.log(`=== Provisioning Sprite: ${spriteName} ===`);
  if (projectRepoUrl) {
    console.log(`Project repo: ${projectRepoUrl}`);
  }

  // Check which env vars are available
  const envContent = buildEnvFileContent();
  const availableVars = ENV_VARS_TO_FORWARD.filter((v) => process.env[v]);
  const missingVars = ENV_VARS_TO_FORWARD.filter((v) => !process.env[v]);

  if (availableVars.length > 0) {
    console.log(`\nEnvironment variables to forward: ${availableVars.join(", ")}`);
  }
  if (missingVars.length > 0) {
    console.log(`Missing (optional): ${missingVars.join(", ")}`);
  }

  // Step 1: Setup SSH for GitHub
  step++;
  console.log(`\n[${step}/${totalSteps}] Setting up SSH for GitHub...`);
  const sshCheck = await tryRun("test -f /home/sprite/.ssh/id_ed25519 && echo 'exists'");
  if (sshCheck.success && sshCheck.stdout.includes("exists")) {
    console.log("SSH keys already exist");
  } else if (!SSH_PRIVATE_KEY || !SSH_PUBLIC_KEY) {
    console.error("ERROR: SPRITE_SSH_PRIVATE_KEY and SPRITE_SSH_PUBLIC_KEY environment variables are required");
    console.error("Add these to your .env file:");
    console.error('  SPRITE_SSH_PRIVATE_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\\n...\\n-----END OPENSSH PRIVATE KEY-----"');
    console.error('  SPRITE_SSH_PUBLIC_KEY="ssh-ed25519 AAAA... sprite@sprite"');
    process.exit(1);
  } else {
    console.log("Creating SSH directory and keys...");
    await run("mkdir -p /home/sprite/.ssh && chmod 700 /home/sprite/.ssh");
    // Handle newlines in the key (env vars may have literal \n)
    const privateKey = SSH_PRIVATE_KEY.replace(/\\n/g, "\n");
    await run(`echo '${privateKey}' > /home/sprite/.ssh/id_ed25519`);
    await run("chmod 600 /home/sprite/.ssh/id_ed25519");
    await run(`echo '${SSH_PUBLIC_KEY}' > /home/sprite/.ssh/id_ed25519.pub`);
    await run(`echo '${SSH_CONFIG}' > /home/sprite/.ssh/config`);
    console.log("SSH keys configured");
  }

  // Step 2: Install Bun
  step++;
  console.log(`\n[${step}/${totalSteps}] Checking for Bun...`);
  const bunCheck = await tryRun("~/.bun/bin/bun --version");
  if (bunCheck.success) {
    console.log("Bun already installed");
  } else {
    console.log("Installing Bun...");
    await run("curl -fsSL https://bun.sh/install | bash");
  }

  // Step 3: Install Rust
  step++;
  console.log(`\n[${step}/${totalSteps}] Checking for Rust...`);
  const rustCheck = await tryRun("~/.cargo/bin/rustc --version");
  if (rustCheck.success) {
    console.log("Rust already installed");
  } else {
    console.log("Installing Rust...");
    await run("curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y");
  }

  // Step 4: Install linear-cli
  step++;
  console.log(`\n[${step}/${totalSteps}] Checking for linear-cli...`);
  const linearCheck = await tryRun("~/.cargo/bin/linear-cli --version || ~/.local/bin/linear-cli --version");
  if (linearCheck.success) {
    console.log("linear-cli already installed");
  } else {
    console.log("Installing linear-cli...");
    await run("~/.cargo/bin/cargo install linear-cli");
  }
  // Create symlink in ~/.local/bin for PATH accessibility
  await tryRun("ln -sf ~/.cargo/bin/linear-cli ~/.local/bin/linear-cli");

  // Step 5: Install agentapi
  step++;
  console.log(`\n[${step}/${totalSteps}] Checking for agentapi...`);
  const agentapiCheck = await tryRun("~/.local/bin/agentapi --version");
  if (agentapiCheck.success) {
    console.log("agentapi already installed");
  } else {
    console.log("Installing agentapi...");
    await run(
      "mkdir -p ~/.local/bin && curl -fsSL -o ~/.local/bin/agentapi https://github.com/coder/agentapi/releases/download/v0.11.8/agentapi-linux-amd64 && chmod +x ~/.local/bin/agentapi"
    );
  }

  // Step 6: Clone Amadeus
  step++;
  console.log(`\n[${step}/${totalSteps}] Setting up Amadeus...`);
  const amadeusCheck = await tryRun("test -f /home/sprite/amadeus/package.json && echo 'exists'");
  if (amadeusCheck.success && amadeusCheck.stdout.includes("exists")) {
    console.log("Amadeus already cloned, pulling latest...");
    await tryRun("cd /home/sprite/amadeus && git pull");
  } else {
    console.log("Cloning Amadeus...");
    await run("git clone --depth 1 git@github.com:mberg/amadeus.git /home/sprite/amadeus");
  }

  // Step 7: Install dependencies
  step++;
  console.log(`\n[${step}/${totalSteps}] Installing Amadeus dependencies...`);
  await run("cd /home/sprite/amadeus && ~/.bun/bin/bun install");

  // Step 8: Clone project repo if specified
  if (projectRepoUrl) {
    step++;
    console.log(`\n[${step}/${totalSteps}] Setting up project repo...`);

    // Extract repo name from URL for directory
    const repoName = projectRepoUrl.split("/").pop()?.replace(".git", "") || "project";
    const projectDir = `/home/sprite/projects/${repoName}`;

    const projectCheck = await tryRun(`test -d ${projectDir}/.git && echo 'exists'`);
    if (projectCheck.success && projectCheck.stdout.includes("exists")) {
      console.log(`Project already cloned at ${projectDir}, pulling latest...`);
      await tryRun(`cd ${projectDir} && git pull`);
    } else {
      console.log(`Cloning project to ${projectDir}...`);
      await run(`mkdir -p /home/sprite/projects`);
      // Convert HTTPS URL to SSH format for private repos
      const sshUrl = projectRepoUrl.replace(/^https:\/\/github\.com\//, "git@github.com:");
      await run(`git clone ${sshUrl} ${projectDir}`);
    }
  }

  // Step 9: Create config from sprite template
  step++;
  console.log(`\n[${step}/${totalSteps}] Creating config from sprite template...`);
  const configCheck = await tryRun("test -f /home/sprite/amadeus/amadeus.config.yaml && echo 'exists'");
  if (configCheck.success && configCheck.stdout.includes("exists")) {
    console.log("Config already exists, skipping (delete manually to recreate)");
  } else {
    const escapedConfig = SPRITE_CONFIG_TEMPLATE.replace(/'/g, "'\\''");
    await run(`echo '${escapedConfig}' > /home/sprite/amadeus/amadeus.config.yaml`);
  }

  // Step 10: Create .env file from forwarded environment variables
  step++;
  console.log(`\n[${step}/${totalSteps}] Creating .env file...`);
  if (envContent) {
    const envCheck = await tryRun("test -f /home/sprite/amadeus/.env && echo 'exists'");
    if (envCheck.success && envCheck.stdout.includes("exists")) {
      console.log(".env already exists, skipping (delete manually to recreate)");
    } else {
      // Write env content to file, escaping for shell
      const escapedContent = envContent.replace(/'/g, "'\\''");
      await run(`echo '${escapedContent}' > /home/sprite/amadeus/.env`);
      console.log(`Created .env with: ${availableVars.join(", ")}`);
    }
  } else {
    console.log("No environment variables to forward, skipping .env creation");
  }

  // Step 11: Setup entry script
  step++;
  console.log(`\n[${step}/${totalSteps}] Setting up entry script...`);
  await run("chmod +x /home/sprite/amadeus/scripts/sprite-entry.sh");

  // Step 12: Make URL public
  step++;
  console.log(`\n[${step}/${totalSteps}] Making sprite URL public...`);
  const urlResult = await Bun.$`sprite url update -s ${spriteName} --auth public`.text();
  console.log(urlResult);

  // Step 13: Create checkpoint
  step++;
  console.log(`\n[${step}/${totalSteps}] Creating checkpoint...`);
  const checkpointResult = await Bun.$`sprite checkpoint create -s ${spriteName}`.text();
  console.log(checkpointResult);

  console.log("\n=== Provisioning Complete ===");

  const nextSteps: string[] = [];
  if (!configCheck.success || !configCheck.stdout.includes("exists")) {
    nextSteps.push("1. Edit /home/sprite/amadeus/amadeus.config.yaml with your realm/project settings");
  }
  if (missingVars.length > 0) {
    nextSteps.push(`2. Add missing env vars to .env: ${missingVars.join(", ")}`);
  }

  if (nextSteps.length > 0) {
    console.log("\nRemaining manual steps:");
    console.log(nextSteps.join("\n"));
  } else {
    console.log("\nSprite is fully provisioned and ready!");
  }
}

main().catch((err) => {
  console.error("Provisioning failed:", err);
  process.exit(1);
});

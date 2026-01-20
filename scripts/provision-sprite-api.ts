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
  const totalSteps = projectRepoUrl ? 6 : 5;
  let step = 0;

  console.log(`=== Provisioning Sprite: ${spriteName} ===`);
  if (projectRepoUrl) {
    console.log(`Project repo: ${projectRepoUrl}`);
  }

  // Step 1: Install Bun
  step++;
  console.log(`\n[${step}/${totalSteps}] Checking for Bun...`);
  const bunCheck = await tryRun("~/.bun/bin/bun --version");
  if (bunCheck.success) {
    console.log("Bun already installed");
  } else {
    console.log("Installing Bun...");
    await run("curl -fsSL https://bun.sh/install | bash");
  }

  // Step 2: Clone Amadeus
  step++;
  console.log(`\n[${step}/${totalSteps}] Setting up Amadeus...`);
  const amadeusCheck = await tryRun("test -f /home/sprite/amadeus/package.json && echo 'exists'");
  if (amadeusCheck.success && amadeusCheck.stdout.includes("exists")) {
    console.log("Amadeus already cloned, pulling latest...");
    await tryRun("cd /home/sprite/amadeus && git pull");
  } else {
    console.log("Cloning Amadeus...");
    await run("git clone --depth 1 https://github.com/mberg/amadeus /home/sprite/amadeus");
  }

  // Step 3: Install dependencies
  step++;
  console.log(`\n[${step}/${totalSteps}] Installing Amadeus dependencies...`);
  await run("cd /home/sprite/amadeus && ~/.bun/bin/bun install");

  // Step 4: Clone project repo if specified
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
      await run(`git clone ${projectRepoUrl} ${projectDir}`);
    }
  }

  // Step 5: Create config
  step++;
  console.log(`\n[${step}/${totalSteps}] Creating config...`);
  await tryRun(
    "cp /home/sprite/amadeus/amadeus.config.example.yaml /home/sprite/amadeus/amadeus.config.yaml 2>/dev/null"
  );

  // Step 6: Setup entry script
  step++;
  console.log(`\n[${step}/${totalSteps}] Setting up entry script...`);
  await run("chmod +x /home/sprite/amadeus/scripts/sprite-entry.sh");

  console.log("\n=== Provisioning Complete ===");
  console.log(`
Next steps:
1. Configure /home/sprite/amadeus/amadeus.config.yaml on the sprite
2. Set up /home/sprite/amadeus/.env with API keys
3. Create a checkpoint for recovery
`);
}

main().catch((err) => {
  console.error("Provisioning failed:", err);
  process.exit(1);
});

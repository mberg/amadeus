// ABOUTME: Generates SSH key on a sprite for GitHub access.
// ABOUTME: Outputs the public key to add to GitHub.

import { SpritesClient } from "@fly/sprites";

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;
if (!SPRITES_TOKEN) {
  console.error("SPRITES_TOKEN environment variable not set");
  process.exit(1);
}

const spriteName = process.argv[2] || "amadeus-zonewise";

const client = new SpritesClient(SPRITES_TOKEN);
const sprite = client.sprite(spriteName);

async function run(cmd: string): Promise<string> {
  const { stdout, stderr } = await sprite.execFile("bash", ["-c", cmd]);
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

async function main() {
  console.log(`Setting up SSH on sprite: ${spriteName}\n`);

  // Create .ssh directory
  await run("mkdir -p ~/.ssh && chmod 700 ~/.ssh");

  // Check if key already exists
  try {
    const existing = await run("cat ~/.ssh/id_ed25519.pub 2>/dev/null");
    if (existing.trim()) {
      console.log("SSH key already exists.\n");
      console.log("=== Add this to GitHub (Settings > SSH and GPG keys > New SSH key) ===\n");
      console.log(existing);
      return;
    }
  } catch {
    // Key doesn't exist, continue
  }

  // Generate new key
  console.log("Generating new SSH key...");
  await run('ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "sprites@amadeus"');

  // Configure SSH for GitHub
  await run(`cat > ~/.ssh/config << 'SSHEOF'
Host github.com
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  IdentityFile ~/.ssh/id_ed25519
SSHEOF`);
  await run("chmod 600 ~/.ssh/config");

  // Get and display public key
  const pubKey = await run("cat ~/.ssh/id_ed25519.pub");

  console.log("\n=== Add this to GitHub (Settings > SSH and GPG keys > New SSH key) ===\n");
  console.log(pubKey);
  console.log("\nTitle suggestion: sprites-amadeus");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

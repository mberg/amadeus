#!/bin/bash
# ABOUTME: Script to provision a new Sprite VM for running Amadeus.
# ABOUTME: Run this on your local machine to set up a Sprite for a specific project.

set -e

# Check for required arguments
if [ -z "$1" ]; then
    echo "Usage: $0 <sprite-name> [amadeus-repo-url]"
    echo ""
    echo "Arguments:"
    echo "  sprite-name      Name for the Sprite (e.g., amadeus-ona)"
    echo "  amadeus-repo-url Optional: Git URL for Amadeus repo (default: https://github.com/mberg/amadeus)"
    echo ""
    echo "Example:"
    echo "  $0 amadeus-ona"
    echo "  $0 amadeus-ml https://github.com/myorg/amadeus-fork"
    exit 1
fi

SPRITE_NAME="$1"
AMADEUS_REPO="${2:-https://github.com/mberg/amadeus}"

echo "=== Provisioning Sprite: $SPRITE_NAME ==="
echo ""

# Step 1: Create the Sprite
echo "[1/6] Creating Sprite..."
sprite create "$SPRITE_NAME"
sprite use "$SPRITE_NAME"

# Step 2: Install Bun
echo ""
echo "[2/6] Installing Bun..."
sprite exec "curl -fsSL https://bun.sh/install | bash"
sprite exec 'echo "export BUN_INSTALL=\"\$HOME/.bun\"" >> ~/.bashrc'
sprite exec 'echo "export PATH=\"\$BUN_INSTALL/bin:\$PATH\"" >> ~/.bashrc'

# Step 3: Clone Amadeus
echo ""
echo "[3/6] Cloning Amadeus repository..."
sprite exec "git clone $AMADEUS_REPO /home/sprite/amadeus"

# Step 4: Install dependencies
echo ""
echo "[4/6] Installing dependencies..."
sprite exec "cd /home/sprite/amadeus && ~/.bun/bin/bun install"

# Step 5: Copy config template
echo ""
echo "[5/6] Setting up configuration..."
sprite exec "cp /home/sprite/amadeus/amadeus.config.example.yaml /home/sprite/amadeus/amadeus.config.yaml"

echo ""
echo "=== Manual Steps Required ==="
echo ""
echo "1. Configure amadeus.config.yaml:"
echo "   sprite exec \"nano /home/sprite/amadeus/amadeus.config.yaml\""
echo ""
echo "   Set runtimeMode to 'sprite' in the global section:"
echo "   global:"
echo "     runtimeMode: sprite"
echo ""
echo "2. Create .env file with API keys:"
echo "   sprite exec \"nano /home/sprite/amadeus/.env\""
echo ""
echo "   Required variables:"
echo "   - LINEAR_API_KEY=lin_api_xxx"
echo "   - LINEAR_WEBHOOK_SECRET=xxx"
echo "   - ANTHROPIC_API_KEY=sk-ant-xxx"
echo "   - ROUTER_SECRET=xxx (if using router)"
echo ""
echo "3. Set up entry script:"
echo "   sprite exec \"chmod +x /home/sprite/amadeus/scripts/sprite-entry.sh\""
echo ""
echo "4. Create a clean checkpoint:"
echo "   sprite checkpoint create --comment \"Clean Amadeus installation\""
echo ""
echo "5. Make webhook endpoint public:"
echo "   sprite url update --auth public"
echo ""
echo "6. Get the Sprite URL for router config:"
echo "   sprite url"
echo ""
echo "=== Done ==="

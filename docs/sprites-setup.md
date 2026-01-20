# Sprites Setup Guide

This guide covers how to run Amadeus inside a [Sprite](https://sprites.dev/) VM for secure, isolated agent execution.

## Overview

Sprites are Firecracker-based VMs that provide:
- Hardware-isolated execution for Claude Code agents
- On-demand compute (Sprites hibernate when idle)
- Persistent development state between sessions
- Checkpoint recovery after failed operations

## Prerequisites

- [Sprites CLI](https://sprites.dev/) installed and configured
- Amadeus router deployed to Cloudflare Workers (optional, for webhook routing)
- Linear API key and webhook secret

## Quick Start

### 1. Provision a New Sprite

Use the provisioning script:

```bash
./scripts/provision-sprite.sh amadeus-ona
```

Or manually:

```bash
# Create and select the Sprite
sprite create amadeus-ona
sprite use amadeus-ona

# Install Bun
sprite exec "curl -fsSL https://bun.sh/install | bash"

# Clone and install Amadeus
sprite exec "git clone https://github.com/mberg/amadeus /home/sprite/amadeus"
sprite exec "cd /home/sprite/amadeus && ~/.bun/bin/bun install"
```

### 2. Configure Amadeus

Create the config file:

```bash
sprite exec "cp /home/sprite/amadeus/amadeus.config.example.yaml /home/sprite/amadeus/amadeus.config.yaml"
sprite exec "nano /home/sprite/amadeus/amadeus.config.yaml"
```

**Important:** Set `runtimeMode: sprite` in the global section:

```yaml
realms:
  ona:
    linearWorkspace: ona
    apiKeyEnvVar: LINEAR_API_KEY
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET
    projects:
      - teamKey: ONA
        path: /home/sprite/projects/truecover

global:
  runtimeMode: sprite  # <-- Required for Sprite mode
  port: 8080           # Sprites route to port 8080
  triggerStates:
    - Planning
```

### 3. Set Up Environment Variables

```bash
sprite exec "nano /home/sprite/amadeus/.env"
```

Required variables:

```bash
# Linear
LINEAR_API_KEY=lin_api_xxx
LINEAR_WEBHOOK_SECRET=xxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx

# Router (if using multi-machine routing)
ROUTER_SECRET=xxx
```

### 4. Create Entry Point

Make the entry script executable:

```bash
sprite exec "chmod +x /home/sprite/amadeus/scripts/sprite-entry.sh"
```

### 5. Create Clean Checkpoint

Before going live, create a checkpoint you can roll back to:

```bash
sprite checkpoint create --comment "Clean Amadeus installation"
```

### 6. Make Webhook Public

Enable public access to receive webhooks:

```bash
sprite url update --auth public
```

### 7. Get Sprite URL

Get the URL for your router configuration:

```bash
sprite url
```

Output example:
```
https://amadeus-ona-abc123.sprites.app
```

## Router Configuration

Add your Sprite to the router config (Cloudflare Worker KV):

```json
{
  "machines": {
    "amadeus-ona": {
      "url": "https://amadeus-ona-abc123.sprites.app",
      "projects": ["ONA"],
      "type": "sprite"
    }
  }
}
```

The `type: "sprite"` field tells the router to skip heartbeat checks (Sprites wake on demand).

## Runtime Mode Differences

| Feature | `machine` mode | `sprite` mode |
|---------|---------------|---------------|
| Heartbeat | Sent every 60s | Disabled |
| Port | From config (default 5678) | `PORT` env var (default 8080) |
| Wake behavior | Always running | Wakes on webhook |
| Health monitoring | Required | Optional |

## Sprite Lifecycle

```
[Dormant] ──webhook──► [Waking] ──ready──► [Active]
                                              │
                                         30s idle
                                              │
                                              ▼
                                         [Hibernating]
                                              │
                                              ▼
                                          [Dormant]
```

Sprites automatically hibernate after 30 seconds of inactivity, eliminating compute costs when idle.

## Checkpoints

### Create Checkpoint

Before risky operations:

```bash
sprite checkpoint create --comment "Before config change"
```

### List Checkpoints

```bash
sprite checkpoint list
```

### Restore Checkpoint

Roll back to a previous state:

```bash
sprite checkpoint restore <checkpoint-id>
```

## Troubleshooting

### Sprite Won't Wake

1. Check the Sprite status:
   ```bash
   sprite status amadeus-ona
   ```

2. View logs:
   ```bash
   sprite logs amadeus-ona
   ```

3. Verify webhook URL is public:
   ```bash
   sprite url
   ```

### Webhook Timeouts

Sprites take 100-500ms to wake from hibernation. The router should handle this automatically, but you may need to increase timeouts for the first request.

### Agent Memory Issues

Each Sprite has 8GB RAM, supporting ~2-4 concurrent Claude Code agents. If running out of memory:

1. Reduce concurrent agent limit in Amadeus config
2. Create separate Sprites for high-activity projects

## Hybrid Setup

You can mix Sprites and local machines in your router config:

```json
{
  "machines": {
    "amadeus-ona": {
      "url": "https://amadeus-ona-abc123.sprites.app",
      "projects": ["ONA"],
      "type": "sprite"
    },
    "macbook": {
      "url": "https://macbook.tailnet-abc.ts.net",
      "projects": ["PERSONAL"],
      "type": "machine"
    }
  }
}
```

This allows:
- Isolated Sprites for sensitive/untrusted code
- Local machines for faster iteration or GPU access
- Gradual migration from machines to Sprites

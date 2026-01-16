# Amadeus Router

A Cloudflare Worker that routes Linear webhooks to different Amadeus instances based on labels and project configuration.

## Overview

The router enables multi-machine Amadeus deployments by:
- Receiving Linear webhooks at a stable cloud URL
- Routing issues to machines based on labels and project configuration
- Monitoring machine health via heartbeats
- Posting comments when target machines are offline

## Architecture

```
┌─────────────────┐
│     Linear      │
│   (Webhooks)    │
└────────┬────────┘
         │ POST /webhook
         ▼
┌─────────────────────────────────┐
│   Cloudflare Worker (Router)    │
│   amadeus-router.workers.dev    │
└──────────┬──────────────────────┘
           │ POST /webhook + X-Amadeus-Secret
           ▼
┌──────────────────────────────────────────────┐
│              Tailscale Network               │
│  ┌─────────────┐  ┌─────────────┐           │
│  │ gpu-beast   │  │ macbook     │  ...      │
│  │ (Amadeus)   │  │ (Amadeus)   │           │
│  └─────────────┘  └─────────────┘           │
└──────────────────────────────────────────────┘
```

## Deployment

### Prerequisites

- [Cloudflare account](https://cloudflare.com)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Linear API key for posting comments

### Setup

1. **Create KV namespace:**

```bash
cd amadeus-router
wrangler kv:namespace create "ROUTER_KV"
```

Update `wrangler.toml` with the returned namespace ID.

2. **Set secrets:**

```bash
# Linear webhook secret (for verifying incoming webhooks)
wrangler secret put LINEAR_WEBHOOK_SECRET

# Linear API key (for posting comments)
wrangler secret put LINEAR_API_KEY

# Shared secret between router and machines
wrangler secret put ROUTER_SECRET

# Router configuration (JSON)
wrangler secret put ROUTER_CONFIG
```

3. **Deploy:**

```bash
wrangler deploy
```

## Configuration

The `ROUTER_CONFIG` secret is a JSON object defining machines and routing rules:

```json
{
  "machines": {
    "gpu-beast": {
      "url": "https://gpu-beast.tailnet-name.ts.net",
      "labels": ["ml", "training", "gpu"],
      "projects": ["ML"]
    },
    "macbook": {
      "url": "https://macbook.tailnet-name.ts.net",
      "labels": ["frontend", "mobile"],
      "projects": ["ONA", "DESIGN"]
    },
    "cloud-vm": {
      "url": "https://cloud-vm.tailnet-name.ts.net",
      "labels": ["backend", "api"],
      "projects": [],
      "default": true
    }
  },
  "secret": "your-shared-secret"
}
```

### Routing Priority

1. **Explicit machine label** - Issue has `machine:gpu-beast` label → route to gpu-beast
2. **Capability label** - Issue has `ml` label → route to machine with `ml` in labels
3. **Project fallback** - Issue from team ML → route to machine with `ML` in projects
4. **Default machine** - No match → route to machine with `default: true`

## Amadeus Configuration

Configure each Amadeus instance to communicate with the router by adding to `amadeus.config.yaml`:

```yaml
global:
  router:
    url: "https://amadeus-router.your-account.workers.dev"
    machineName: "macbook"
    secretEnvVar: "ROUTER_SECRET"
```

Set the environment variable:

```bash
export ROUTER_SECRET="your-shared-secret"
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | Receives Linear webhooks, routes to machines |
| `/heartbeat` | POST | Receives machine heartbeats |
| `/status` | GET | Returns all machines and their health (requires auth) |
| `/health` | GET | Health check endpoint |

### Heartbeat Request

Machines send heartbeats every 60 seconds:

```json
POST /heartbeat
{
  "machine": "macbook",
  "secret": "your-shared-secret"
}
```

### Status Response

```json
GET /status
Authorization: your-shared-secret

{
  "machines": [
    {
      "name": "macbook",
      "url": "https://macbook.ts.net",
      "labels": ["frontend"],
      "projects": ["ONA"],
      "default": false,
      "lastHeartbeat": 1705123456789,
      "healthy": true
    }
  ],
  "timestamp": 1705123460000
}
```

## Offline Handling

When a target machine is offline (no heartbeat in the last 2 minutes):

1. Router posts a Linear comment: "⚠️ Target machine 'macbook' is currently offline. Move issue back to Planning when ready to retry."
2. Returns 200 OK to Linear
3. User retries by moving the issue back to a trigger state

## Development

```bash
cd amadeus-router
bun install
bun test
wrangler dev  # Local development
```

## Security

- Linear webhooks are verified using HMAC-SHA256 signatures
- Machine-to-router communication uses a shared secret (`ROUTER_SECRET`)
- Router-to-machine forwarding includes `X-Amadeus-Secret` header

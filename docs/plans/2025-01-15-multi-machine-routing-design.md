# Multi-Machine Routing via Cloudflare Worker

## Overview

This design enables Amadeus to route Linear issues to different machines based on labels and project configuration. A Cloudflare Worker acts as a central router, receiving webhooks from Linear and forwarding them to the appropriate Tailscale-connected machine.

## Goals

- Route different projects/issues to different machines on a Tailscale network
- Allow users to send tasks to personal machines via labels
- Provide health awareness to avoid routing to offline machines
- Keep the architecture simple and maintainable

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
│                                 │
│   • Verifies Linear signature   │
│   • Reads labels & project      │
│   • Looks up target machine     │
│   • Checks machine health (KV)  │
│   • Forwards or posts comment   │
└──────────┬──────────────────────┘
           │ POST /webhook + X-Amadeus-Secret
           ▼
┌──────────────────────────────────────────────┐
│              Tailscale Network               │
│                                              │
│  ┌─────────────┐  ┌─────────────┐           │
│  │ gpu-beast   │  │ macbook     │  ...      │
│  │ ts.net/wh   │  │ ts.net/wh   │           │
│  │             │  │             │           │
│  │ Amadeus     │  │ Amadeus     │           │
│  │ (agents)    │  │ (agents)    │           │
│  └─────────────┘  └─────────────┘           │
└──────────────────────────────────────────────┘
```

### Request Flow

1. Linear sends webhook to Cloudflare Worker
2. Worker verifies Linear signature
3. Worker extracts labels and project from issue
4. Worker determines target machine using routing rules
5. Worker checks if machine is healthy (recent heartbeat)
6. If healthy → forward webhook with secret header
7. If unhealthy → post Linear comment explaining machine is offline

## Routing Configuration

The Worker stores routing rules in Cloudflare KV:

```json
{
  "machines": {
    "gpu-beast": {
      "url": "https://gpu-beast.tailnet-abc.ts.net",
      "labels": ["ml", "training", "gpu"],
      "projects": ["ML"]
    },
    "macbook": {
      "url": "https://macbook.tailnet-abc.ts.net",
      "labels": ["frontend", "mobile"],
      "projects": ["ONA", "DESIGN"]
    },
    "cloud-vm": {
      "url": "https://vm.tailnet-abc.ts.net",
      "labels": ["backend", "api"],
      "projects": [],
      "default": true
    }
  },
  "secret": "<shared-secret-here>"
}
```

### Routing Priority

1. **Explicit machine label** - Issue has `machine:gpu-beast` label → route to gpu-beast
2. **Capability label** - Issue has `ml` label → route to machine with `ml` in labels array
3. **Project fallback** - Issue is from ML team → route to machine with `ML` in projects array
4. **Default machine** - No match → route to machine with `default: true`

### Example Scenarios

| Issue | Labels | Team | Routed To | Reason |
|-------|--------|------|-----------|--------|
| ONA-123 | `machine:macbook` | ONA | macbook | Explicit machine label |
| ML-456 | `gpu` | ML | gpu-beast | Capability label match |
| ONA-789 | (none) | ONA | macbook | Project fallback |
| RANDOM-1 | (none) | OTHER | cloud-vm | Default machine |

## Health Monitoring

Each Amadeus instance sends heartbeats to the Worker every 60 seconds.

### Heartbeat Flow

```
Amadeus (on machine)              Cloudflare Worker
        │                                │
        │  POST /heartbeat               │
        │  {machine: "macbook",          │
        │   secret: "..."}               │
        │ ─────────────────────────────► │
        │                                │ Store in KV:
        │                                │ heartbeat:macbook = timestamp
        │         200 OK                 │
        │ ◄───────────────────────────── │
```

### Health Check Logic

- Machine is "healthy" if last heartbeat < 2 minutes ago
- Worker checks KV timestamp before routing
- Stale heartbeat = machine considered offline

## Offline Handling

When the target machine is offline, the Worker posts a comment and holds.

### Flow

1. Webhook arrives for issue ONA-123
2. Worker determines target: macbook
3. Worker checks KV: `heartbeat:macbook` = 10 min ago (stale)
4. Worker posts Linear comment:
   > ⚠️ Target machine 'macbook' is currently offline.
   > Move issue back to Planning when ready to retry.
5. Worker returns 200 OK to Linear (webhook acknowledged)
6. Issue stays in current state, user decides when to retry

### User Retry Flow

1. User sees comment, knows machine was offline
2. User starts machine / fixes network
3. User moves issue back to "Planning" (or trigger state)
4. Linear sends new webhook
5. Worker routes successfully

## Authentication

### Linear → Worker

- Linear signs webhooks with HMAC-SHA256
- Worker verifies signature using Linear webhook secret
- Invalid signatures rejected with 401

### Worker → Machines

- Machines expose webhook endpoint via Tailscale Funnel (public URL)
- Worker includes `X-Amadeus-Secret` header with shared secret
- Amadeus instances verify header before processing
- Requests without valid secret rejected with 401

## Implementation Components

### 1. Cloudflare Worker (new repo: `amadeus-router`)

```
amadeus-router/
├── src/
│   ├── index.ts        # Main worker entry, request routing
│   ├── routing.ts      # Label/project matching logic
│   ├── health.ts       # Heartbeat storage/checking
│   └── linear.ts       # Signature verification, comment posting
├── wrangler.toml       # Cloudflare config (KV bindings, etc.)
└── README.md           # Setup and deployment instructions
```

#### Worker Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhook` | POST | Receives Linear webhooks, routes to machines |
| `/heartbeat` | POST | Receives machine heartbeats |
| `/status` | GET | Returns all machines and health (debugging) |
| `/config` | POST | Update routing config (admin, secret-protected) |

### 2. Amadeus Changes (this repo)

#### Heartbeat Sender

Add background task that runs every 60 seconds:

```typescript
setInterval(async () => {
  await fetch(ROUTER_URL + '/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      machine: MACHINE_NAME,
      secret: ROUTER_SECRET
    })
  });
}, 60_000);
```

#### Secret Verification

Verify incoming webhooks have valid secret:

```typescript
const secret = request.headers.get('X-Amadeus-Secret');
if (secret !== ROUTER_SECRET) {
  return new Response('Unauthorized', { status: 401 });
}
```

#### New Environment Variables

| Variable | Description |
|----------|-------------|
| `ROUTER_URL` | Cloudflare Worker URL (e.g., `https://amadeus-router.workers.dev`) |
| `MACHINE_NAME` | This machine's identifier (e.g., `macbook`) |
| `ROUTER_SECRET` | Shared secret for authentication |

### 3. Configuration

- Create Cloudflare KV namespace for routing config + heartbeats
- Update Linear webhook URL to point to Worker
- Configure each machine's `.env` with router credentials

## Deployment Steps

1. Create `amadeus-router` Cloudflare Worker
2. Set up KV namespace and bindings
3. Configure routing rules in KV
4. Update Linear webhook URL to Worker
5. Add router env vars to each Amadeus instance
6. Deploy updated Amadeus with heartbeat sender

## Future Considerations (Out of Scope)

- **Dashboard UI** - View machines, health status, recent routes in browser
- **Webhook replay** - Re-send failed webhooks from dashboard
- **Multi-workspace** - Different Worker instances per Linear workspace
- **Load balancing** - Route to least-busy machine when multiple match

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Router location | Cloudflare Worker | Always available, free tier, Linear needs stable URL |
| Machine registration | Hybrid (static config + heartbeats) | Control over routing rules + health awareness |
| Offline handling | Comment and hold | Simple, user has control, no complex queuing |
| Authentication | Tailscale Funnel + shared secret | Uses existing Funnel setup, simple to implement |
| Routing priority | Label → Capability → Project → Default | Explicit overrides implicit, sensible fallbacks |

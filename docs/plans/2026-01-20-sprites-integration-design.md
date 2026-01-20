# Sprites Integration Design

## Overview

Integrate [Sprites](https://sprites.dev/) as the sandbox runtime environment for Amadeus agents. Each Sprite runs its own Amadeus server, providing hardware-isolated execution for Claude Code agents. The existing Cloudflare Worker router forwards webhooks to Sprites instead of bare machines.

## Goals

- **Secure sandbox isolation**: Run agents in Firecracker VMs with controlled network egress
- **On-demand compute**: Sprites hibernate when idle, eliminating compute costs during inactivity
- **Seamless integration**: Leverage existing router architecture for webhook routing
- **Persistent development state**: Preserve git repos, packages, and config between sessions
- **Checkpoint recovery**: Enable rollback after failed agent operations

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
│   • Looks up target Sprite      │
│   • Forwards to Sprite URL      │
└──────────┬──────────────────────┘
           │ POST /webhook
           ▼
┌──────────────────────────────────────────────────────┐
│                  Sprites Network                      │
│                                                       │
│  ┌─────────────────────┐  ┌─────────────────────┐    │
│  │ ona-dev.sprites.app │  │ ml-prod.sprites.app │    │
│  │                     │  │                     │    │
│  │  ┌───────────────┐  │  │  ┌───────────────┐  │    │
│  │  │ Amadeus       │  │  │  │ Amadeus       │  │    │
│  │  │ Server        │  │  │  │ Server        │  │    │
│  │  │               │  │  │  │               │  │    │
│  │  │ Agent Agent   │  │  │  │ Agent Agent   │  │    │
│  │  │ :8001 :8002   │  │  │  │ :8001 :8002   │  │    │
│  │  └───────────────┘  │  │  └───────────────┘  │    │
│  │                     │  │                     │    │
│  │  Firecracker VM     │  │  Firecracker VM     │    │
│  │  8 vCPU, 8GB RAM    │  │  8 vCPU, 8GB RAM    │    │
│  │  100GB Storage      │  │  100GB Storage      │    │
│  └─────────────────────┘  └─────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### Request Flow

1. Linear sends webhook to Cloudflare Worker
2. Worker verifies signature and extracts labels/project
3. Worker looks up target Sprite URL from routing config
4. Worker forwards webhook to Sprite's public URL
5. Sprite wakes from hibernation if dormant (~100-500ms)
6. Amadeus inside Sprite receives webhook on port 8080
7. Amadeus spawns or messages agent based on webhook type
8. Agent works on issue, communicates back to Linear via `linear-cli`
9. After 30 seconds of inactivity, Sprite hibernates

### Sprite Lifecycle

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

## Integration Model Options

### Option A: Sprite-per-Realm (Recommended)

Each Linear realm (workspace/team) gets its own Sprite:

| Sprite | Realm | Projects |
|--------|-------|----------|
| `ona-dev` | ONA | ONA, DESIGN |
| `ml-ops` | ML | ML, TRAINING |
| `backend-prod` | API | API, INFRA |

**Pros:**
- Natural mapping to existing realm config
- Shared agent pool within realm
- Single Amadeus config per Sprite
- Cost-effective (Sprites hibernate when realm inactive)

**Cons:**
- Agents within a realm share isolation boundary
- All projects in realm share 8GB RAM limit

### Option B: Sprite-per-Issue

Each Linear issue gets a dedicated Sprite:

**Pros:**
- Maximum isolation between tasks
- Checkpoint per-issue for easy recovery
- No resource contention

**Cons:**
- Higher latency (cold start per new issue)
- Higher cost (more Sprites active)
- More complex orchestration
- Requires external Sprite manager

### Recommendation

**Start with Option A (Sprite-per-Realm)**. This aligns with existing architecture patterns and provides good isolation at the realm boundary. Option B can be explored later for high-security workloads.

## Components

### 1. Sprite Provisioning (Manual Initial Setup)

Each realm gets a pre-configured Sprite:

```bash
# Create Sprite for ONA realm
sprite create amadeus-ona
sprite use amadeus-ona

# Install Amadeus dependencies
sprite exec "git clone https://github.com/mberg/amadeus /home/sprite/amadeus"
sprite exec "cd /home/sprite/amadeus && bun install"

# Configure Amadeus
sprite exec "cp /home/sprite/amadeus/amadeus.config.example.yaml /home/sprite/amadeus/amadeus.config.yaml"
# Edit config via console or file upload

# Create clean checkpoint
sprite checkpoint create --comment "Clean Amadeus installation"

# Make webhook endpoint public
sprite url update --auth public
```

### 2. Sprite Bootstrap Service (`sprite-entry.sh`)

Entry script that starts Amadeus when Sprite wakes:

```bash
#!/bin/bash
# /home/sprite/sprite-entry.sh

cd /home/sprite/amadeus

# Load environment
source .env

# Start Amadeus server on port 8080 (Sprite's routed port)
PORT=8080 bun run src/server.ts &

# Keep Sprite alive while Amadeus runs
wait
```

### 3. Router Config Updates

Update Cloudflare Worker to route to Sprite URLs:

```json
{
  "machines": {
    "amadeus-ona": {
      "url": "https://amadeus-ona-abc123.sprites.app",
      "labels": ["frontend", "mobile"],
      "projects": ["ONA", "DESIGN"]
    },
    "amadeus-ml": {
      "url": "https://amadeus-ml-def456.sprites.app",
      "labels": ["ml", "training", "gpu"],
      "projects": ["ML"]
    }
  },
  "secret": "<shared-secret>"
}
```

### 4. Health Monitoring Adaptation

Sprites don't need heartbeats in the same way machines do:

**Current behavior (machines):**
- Amadeus sends heartbeat every 60s
- Router marks machine offline if heartbeat stale

**New behavior (Sprites):**
- Sprites are always "available" (they wake on request)
- Router can probe Sprite status via Sprites API (optional)
- Remove heartbeat requirement for Sprite-based endpoints

### 5. Amadeus Server Modifications

Minimal changes needed:

```typescript
// src/server.ts - Support Sprite port configuration
const PORT = parseInt(process.env.PORT || '5678');

Bun.serve({
  port: PORT,  // Use PORT env var (8080 in Sprites)
  routes: {
    '/webhook': handleWebhook,
    // ... existing routes
  }
});
```

### 6. Agent Execution Inside Sprites

Agents run as subprocesses within the Sprite, same as current behavior:

```
Sprite VM
├── Amadeus Server (port 8080)
│   ├── Agent 1 subprocess (port 8001)
│   ├── Agent 2 subprocess (port 8002)
│   └── Agent 3 subprocess (port 8003)
└── Git worktrees in /home/sprite/amadeus/worktrees/
```

The 8GB RAM limit means ~2-4 concurrent agents per Sprite (Claude Code agents use 1-2GB each).

## Networking & Security

### Ingress

- Sprite URL is public (required for webhook delivery)
- Router adds `X-Amadeus-Secret` header for authentication
- Amadeus verifies secret before processing webhooks

### Egress

Sprites have unrestricted outbound access by default. For production, consider:

```yaml
# Future: Configure egress allowlist in Sprite
egress:
  allowlist:
    - api.linear.app      # Linear API
    - api.anthropic.com   # Claude API
    - github.com          # Git operations
    - registry.npmjs.org  # Package installs
```

### Secrets Management

Environment variables stored in Sprite's persistent filesystem:

```bash
# /home/sprite/amadeus/.env
LINEAR_API_KEY=lin_api_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
ROUTER_SECRET=xxx
```

These persist across hibernation cycles.

## Checkpoint Strategy

### Clean State Checkpoint

After initial setup, create a "golden" checkpoint:

```bash
sprite checkpoint create --comment "Clean state: Amadeus installed, no active agents"
```

### Recovery Checkpoint

Before risky operations (e.g., major config changes):

```bash
sprite checkpoint create --comment "Pre-config-change backup"
```

### Automated Checkpoints (Future)

Consider periodic checkpoints or checkpoint-on-agent-completion for recovery.

## Configuration

### New Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SPRITE_MODE` | Enable Sprite-specific behaviors | `true` |
| `PORT` | Server port (Sprites route to 8080) | `8080` |

### amadeus.config.yaml Updates

```yaml
# Sprite-specific configuration
runtime:
  mode: sprite  # 'sprite' | 'machine' | 'local'

# Sprite mode automatically:
# - Disables heartbeat sender (Sprites don't need it)
# - Uses PORT env var for server port
# - Adjusts health check intervals for hibernation tolerance
```

## Costs

### Sprites Pricing (as of Jan 2026)

| Resource | Rate | Typical Usage |
|----------|------|---------------|
| CPU | $0.07/vCPU-hr | ~$0.50/hr active |
| Memory | $0.04/GB-hr | ~$0.32/hr for 8GB |
| Storage | $0.00068/GB-hr | ~$0.07/mo for 100GB |

### Cost Scenarios

**Low activity realm (2 hrs/day active):**
- $0.82/hr × 2 hrs × 30 days = ~$50/month

**High activity realm (8 hrs/day active):**
- $0.82/hr × 8 hrs × 30 days = ~$200/month

**Idle realm:**
- Storage only: ~$0.07/month

## Implementation Phases

### Phase 1: Proof of Concept

1. Create single Sprite for ONA realm
2. Install Amadeus manually
3. Configure router to forward ONA webhooks to Sprite
4. Test end-to-end: issue → webhook → Sprite → agent → Linear update
5. Validate hibernation/wake cycle

### Phase 2: Production Hardening

1. Create entry script for reliable Amadeus startup
2. Establish checkpoint strategy
3. Document Sprite provisioning runbook
4. Add Sprite status to dashboard (optional)

### Phase 3: Multi-Realm Rollout

1. Create Sprites for additional realms
2. Update router config
3. Migrate workloads from bare machines
4. Decommission old machine-based setup

### Phase 4: Automation (Future)

1. Sprite provisioning via SDK
2. Automated checkpoint management
3. Sprite scaling (multiple per realm for high load)
4. Egress policy enforcement

## Files to Modify

### Amadeus Repository

| File | Change |
|------|--------|
| `src/server.ts` | Support `PORT` env var |
| `src/router-heartbeat.ts` | Skip heartbeat in Sprite mode |
| `amadeus.config.yaml` | Add `runtime.mode` option |
| `docs/sprites-setup.md` | New: Sprite provisioning guide |

### Router Repository

| File | Change |
|------|--------|
| `src/routing.ts` | Handle Sprite URLs (no heartbeat check) |
| `src/health.ts` | Optional: probe Sprite status via API |

### New Files

| File | Purpose |
|------|---------|
| `scripts/sprite-entry.sh` | Sprite startup script |
| `scripts/provision-sprite.sh` | Sprite setup automation |

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Isolation model | Sprite-per-Realm | Balances isolation with cost; aligns with existing realm concept |
| Sprite port | 8080 | Sprites route public URL to 8080 by default |
| Heartbeat strategy | None for Sprites | Sprites wake on demand; always "available" |
| Initial setup | Manual | Keep simple; automate in Phase 4 |
| Agent isolation | Process-level (within Sprite) | Same as current; Sprite provides outer boundary |
| Checkpoint strategy | Manual + golden state | Start simple; automate later |

## Open Questions

1. **Concurrent agent limit**: How many agents can run effectively in 8GB RAM? Need testing.
2. **Wake latency tolerance**: Is 100-500ms wake time acceptable for Linear webhook SLAs?
3. **Egress policies**: Should we restrict network access? Which domains are required?
4. **Multi-Sprite scaling**: If one realm needs more capacity, how do we load-balance?
5. **Sprite lifecycle**: Who manages Sprite creation/deletion? Manual vs automated?

## References

- [Sprites Documentation](https://sprites.dev/)
- [Sprites JavaScript SDK](https://github.com/superfly/sprites-docs/tree/main/src/content/docs/sdks)
- [Multi-Machine Routing Design](./2025-01-15-multi-machine-routing-design.md)

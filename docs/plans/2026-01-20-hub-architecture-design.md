# Hub Architecture Design

## Overview

Refactor Amadeus to cleanly separate routing, visibility, and agent execution concerns while maintaining simplicity for solo users.

## Concepts and Terminology

| Concept | Description | Example |
|---------|-------------|---------|
| **Router** | Routes webhooks to machines. Stateless, simple. | Cloudflare Worker, or local process |
| **Hub** | Dashboard for visibility across all machines/agents. Aggregates status, links to machine dashboards. | Web UI at `hub.example.com` or `localhost:5678` |
| **Machine** | Compute that runs agents. Has a friendly name. Optionally sends heartbeats. | "Frank" (local Mac), "Bob" (a sprite) |
| **Agent** | Per-issue work unit. Spawned by a machine. Has a profile defining its behavior. | Agent working on `ENG-123` |

**Relationships:**
```
Router ──webhook──→ Machine ──spawns──→ Agent
                        ↑
Hub ←──heartbeat/push───┘ (optional)
```

Router and Hub are separate concepts but can run in the same process.

## Runtime Modes

Single Amadeus binary with three modes:

| Mode | Dashboard | Agent execution | Use case |
|------|-----------|-----------------|----------|
| **`standalone`** | Hub + Machine combined | Yes | Solo user on local Mac |
| **`hub`** | Hub only (aggregated view, links out) | No | Org deployment, SaaS offering |
| **`machine`** | Machine only (local agents, chat) | Yes | Sprites, dedicated worker boxes |

## Dashboards

| Dashboard | Shows | Features |
|-----------|-------|----------|
| **Hub dashboard** | All machines, aggregated agent status | Overview, machine health/resources, links to machine dashboards |
| **Machine dashboard** | Agents on this machine | Chat/interaction, logs, CPU/memory/disk usage, agent resource consumption |

Hub shows "what's happening across my fleet." Machine dashboard shows "let me interact with this specific agent."

## Config Structure

### Solo user (standalone mode)
```yaml
machine:
  name: "MacBook"

realms:
  - name: "work"
    linear:
      token: ${WORK_LINEAR_TOKEN}
    projects:
      - team: "ENG"
        repo: "/Users/matt/code/app"

  - name: "consulting"
    linear:
      token: ${CLIENT_LINEAR_TOKEN}
    projects:
      - team: "PROJ"
        repo: "/Users/matt/code/client-project"
```

### Hub mode (org deployment)
```yaml
mode: hub

realms:
  - name: "acme"
    linear:
      token: ${ACME_LINEAR_TOKEN}
      workspaceId: "acme-eng"
    projects:
      - team: "ENG"
        repo: "https://github.com/acme/app"
        machine: "Frank"
      - team: "DATA"
        repo: "https://github.com/acme/pipeline"
        machine: "Bob"

machines:
  - name: "Frank"
    url: "https://frank.local:5678"
  - name: "Bob"
    url: "https://bob-sprite.sprites.dev"
```

### Machine mode
```yaml
mode: machine

machine:
  name: "Frank"
  hub: "https://hub.example.com"
  heartbeat: false  # Optional, can disable for sprites

github:
  token: ${GITHUB_TOKEN}
claude:
  apiKey: ${ANTHROPIC_API_KEY}
```

**Key points:**
- Realms are always required (even solo users may have multiple Linear accounts)
- Machines have friendly names visible in dashboards
- Heartbeat is optional (sprites may disable to avoid keeping VMs active)
- Hub owns routing truth; machines just receive work and execute

## Communication Flow

**Standalone mode:** All in one process, no network hops.

**Hub + Machine mode:**
1. Webhook hits hub
2. Hub looks up realm → project → machine mapping
3. Hub forwards webhook to machine URL
4. Machine spawns agent, handles from there

**Dashboard updates:**
- Hub fetches on-demand when dashboard loads (good for sprites)
- Machines can push status changes for always-on machines (optional)

## Code Structure

```
src/
  shared/           # Used by all modes
    config.ts       # Config loading, validation
    linear.ts       # Linear API client
    types.ts        # Core types (Machine, Agent, Realm, etc.)

  hub/              # Hub mode
    router.ts       # Webhook routing logic
    dashboard/      # Aggregated dashboard UI
    registry.ts     # Machine registry (static config + optional heartbeat)

  machine/          # Machine mode
    orchestrator.ts # Agent lifecycle
    dashboard/      # Machine-specific dashboard UI (chat, resources)
    persistence.ts  # Local SQLite for agent state

  server.ts         # Entry point, wires up based on mode
```

**Standalone mode** loads both `hub/` and `machine/`. **Hub mode** skips `machine/`. **Machine mode** skips `hub/`.

## Migration Path

1. Refactor code structure - Move files into `hub/`, `machine/`, `shared/` without changing behavior
2. Add mode flag - `mode: standalone` as default, current behavior preserved
3. Rename config keys - `runtimeMode` → `mode`, standardize terminology
4. Update dashboards - Hub view vs machine view
5. Deprecate old config - Warn but support for one release cycle

**Breaking changes:**
- Config file format changes (provide migration script)
- Dashboard URL structure may change

## Design Decisions

- **Single binary with modes** over separate packages (code reuse, simpler deployment)
- **Realms always required** (even solo users have multiple Linear accounts)
- **Heartbeat optional** (sprites may disable to avoid keeping VMs active)
- **Hub links to machine dashboards** rather than proxying them (simpler auth model)
- **Machine dashboards include resource monitoring** (CPU, memory, disk)

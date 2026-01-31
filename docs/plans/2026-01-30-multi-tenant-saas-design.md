# Multi-Tenant SaaS Hub Design

## Overview

Transform the Amadeus hub from a single-user server into a multi-tenant SaaS platform. The open-source core remains fully functional standalone, while a separate proprietary repo layers on multi-tenancy, Postgres persistence, and org management via Clerk Organizations.

## Repo Split

### amadeus (open source)

The core: config schema/parsing, webhook handling, agent orchestration, machine registry, dashboard UI, health monitoring. Single-tenant, YAML config on disk, SQLite persistence. Defines interfaces that the SaaS layer implements.

### amadeus-cloud (proprietary)

The SaaS layer: imports `amadeus` as a dependency. Adds multi-tenancy via Clerk Organizations, Postgres for config/state/metrics, encrypted secrets storage, and org-scoped routing. Provides its own server entrypoint that wires core components with Postgres-backed implementations.

## Extension Interfaces

The core defines four interfaces with simple default implementations. The SaaS repo provides Postgres-backed alternatives.

### ConfigStore

```typescript
interface ConfigStore {
  load(orgId: string): Promise<string | null>       // returns YAML
  save(orgId: string, yaml: string): Promise<void>
}
```

- **Single-player**: reads/writes `amadeus.config.yaml` from disk
- **SaaS**: reads/writes `organizations.config_yaml` in Postgres

### MachineAuthenticator

```typescript
interface MachineAuthenticator {
  authenticate(apiKey: string): Promise<{
    orgId: string
    machineName: string
  } | null>
}
```

- **Single-player**: checks against `AMADEUS_API_KEY` env var
- **SaaS**: hashes key, looks up in `machines` table

### SecretsResolver

```typescript
interface SecretsResolver {
  resolve(orgId: string, keyName: string): Promise<string | null>
}
```

- **Single-player**: `process.env[keyName]`
- **SaaS**: checks `secrets` table first (encrypted), falls back to env vars

### MetricsRecorder

```typescript
interface MetricsRecorder {
  recordCompletedTask(orgId: string, task: CompletedTask): Promise<void>
  getCompletedTasks(orgId: string, opts: PaginationOpts): Promise<CompletedTask[]>
  getTaskCount(orgId: string): Promise<number>
}
```

- **Single-player**: SQLite (`amadeus-agents.db`)
- **SaaS**: Postgres `completed_tasks` table

### Server Factory

```typescript
function createServer(opts: {
  configStore?: ConfigStore
  authenticator?: MachineAuthenticator
  secrets?: SecretsResolver
  metrics?: MetricsRecorder
})
```

The SaaS entrypoint calls `createServer()` with Postgres implementations. The core never imports Postgres, Clerk orgs, or encryption libraries.

## Data Model (Postgres — SaaS only)

All tables scoped by `org_id` (Clerk Organization ID). The core's SQLite schema stays unchanged for single-player.

```sql
CREATE TABLE organizations (
  org_id      TEXT PRIMARY KEY,   -- Clerk org ID
  config_yaml TEXT,               -- full YAML config blob
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE machines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT REFERENCES organizations(org_id),
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,     -- bcrypt/argon2 hash
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_seen    TIMESTAMPTZ
);

CREATE TABLE secrets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT REFERENCES organizations(org_id),
  key_name      TEXT NOT NULL,    -- e.g. "LINEAR_API_KEY_ONA"
  encrypted_val BYTEA NOT NULL,   -- encrypted with per-org or global key
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, key_name)
);

CREATE TABLE completed_tasks (
  id                 SERIAL PRIMARY KEY,
  org_id             TEXT REFERENCES organizations(org_id),
  key                TEXT NOT NULL,
  issue_id           TEXT NOT NULL,
  issue_identifier   TEXT NOT NULL,
  issue_title        TEXT NOT NULL,
  linear_project     TEXT,
  completed_at       TIMESTAMPTZ NOT NULL,
  completion_reason  TEXT NOT NULL,
  final_linear_state TEXT,
  duration_ms        INTEGER NOT NULL
);

CREATE INDEX idx_completed_tasks_org_date
  ON completed_tasks (org_id, completed_at DESC);
```

No separate `users` or `memberships` tables — all managed by Clerk Organizations.

## Request Flow

### Dashboard/API (human users)

1. Clerk middleware extracts user + active organization from session
2. Org-scoping middleware sets `org_id` on request context
3. All downstream queries filter by `org_id`
4. User switches between orgs via Clerk's org switcher

### Machine heartbeats (server-to-server)

1. Machine sends `Authorization: Bearer <api_key>`
2. SaaS auth middleware hashes the key, looks up in `machines` table
3. Match gives us `org_id` — machine scoped to its org
4. Heartbeat updates that org's machine registry

### Linear webhook ingress

1. Linear sends webhook to `https://hub.example.com/webhook/<org_id>`
2. Hub loads that org's config from Postgres
3. Verifies Linear signature using that org's webhook secret (from `secrets` table or env var)
4. Routes to the appropriate machine within that org

The org-specific webhook URL is how the hub determines which org's config and secrets to use before any auth has happened.

## Machine Registration

### Registration flow

1. User goes to dashboard, clicks "Add Machine"
2. SaaS hub generates a unique API key, shows it once
3. Stores `bcrypt(api_key)` in `machines` table with user's `org_id`
4. User configures their local Amadeus machine:
   ```yaml
   global:
     runtimeMode: machine
     machine:
       name: "My Laptop"
       hubUrl: "https://hub.example.com"
       apiKey: "the-generated-key"
       heartbeat: true
   ```
5. Machine starts sending heartbeats, hub resolves org from API key

### Deregistration

User removes a machine from dashboard, key deleted from Postgres. Next heartbeat gets a 401.

### Key rotation

User regenerates a machine's API key from dashboard. Old key immediately invalidated.

## Changes to Open-Source Core

1. **Extract `createServer()` factory** — Refactor `server.ts` from top-level module side effects into a factory function that accepts interface implementations and returns the Bun server.

2. **Define the four interfaces** — `ConfigStore`, `MachineAuthenticator`, `SecretsResolver`, `MetricsRecorder`. Ship with filesystem/env/SQLite defaults.

3. **Add `apiKey` to machine config schema** — Already has `hubUrl` and `heartbeat`, just needs the key field.

4. **Make config loading async** — Currently synchronous filesystem reads. Needs to be async for Postgres lookups. Ripples through `loadConfig()` and startup.

5. **Decouple Clerk from core** — Move Clerk to an optional dependency behind an `AuthProvider` interface. Single-player runs with no auth or simple token auth without Clerk installed.

## New in amadeus-cloud

1. Postgres implementations of the four interfaces
2. Clerk Organizations middleware (org switching, membership checks)
3. Machine registration API (generate keys, list/delete machines)
4. Secrets encryption/decryption layer
5. Org-scoped webhook URLs (`/webhook/:orgId`)
6. Dashboard additions: org switcher, machine management UI, usage stats page
7. SaaS server entrypoint wiring everything together

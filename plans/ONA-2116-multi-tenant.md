# ONA-2116: Make Amadeus Multi-Tenant

## Current State Analysis

### What's Already There (Foundations)
The codebase has significant **scaffolding** for multi-tenancy, but it's all wired to a single "default" org:

- **DB schema** (`src/db/schema.sql`) has `org_id` on all tables: `organizations`, `machines`, `secrets`, `completed_tasks`, `users`, `realms`, `projects`, etc.
- **DB queries** (`src/db/*.ts`) accept `orgId` parameters throughout
- **`organizations` table** stores per-org `config_yaml`
- **`getRequestOrgId()`** (`src/org.ts`) extracts org from `/webhook/:orgId` URL pattern
- **Cloud handler** (`cloud/src/cloud-handler.ts`) calls `resolveOrgId()` for each request
- **Realm system** groups Linear workspaces + credentials, scoped by org_id

### What's NOT Multi-Tenant (The Gaps)

#### Gap 1: Org Resolution Always Returns "default"
- `cloud/src/org-auth.ts:15` — hardcodes `const orgId = "default"` regardless of user session
- `src/org.ts` — only extracts from `/webhook/:orgId` URL pattern, otherwise returns "default"
- No Better Auth organization plugin integration

#### Gap 2: Server Startup Hardcodes "default"
- `server.ts:45` — `getMachines("default")`
- `server.ts:78` — `recordCompletedTask("default", ...)`
- `initConfig()` always called with implicit "default" org
- `CONFIG` and `REALM_CONFIG` are **global singletons** — only one org's config can be loaded

#### Gap 3: In-Memory Components Not Org-Scoped
- **ClaudeOrchestrator** (`src/orchestrator.ts`) — single instance, no org concept in agent keys or state
- **MachineRegistry** (`src/hub/registry.ts`) — single in-memory registry, no org partitioning
- **AgentPersistence** (`src/persistence.ts`) — single SQLite DB, no org column in tables
- **HealthMonitor** — single instance monitoring all agents
- **IdleScanner** — scans all machines regardless of org

#### Gap 4: Auth Not Org-Scoped
- `src/auth.ts:91` — `getUserByEmail("default", email)`
- `src/auth.ts:93` — `getOrgMemberRole("default", hubUser.id)`
- `AuthContext` interface has no `orgId` field
- Role checks don't consider org membership

#### Gap 5: API & Dashboard Not Org-Scoped
- `/status` returns all agents regardless of org
- `/hub/status` returns all machines
- Hub API (`/hub/api/*`) gets orgId from URL but falls back to "default"
- Config endpoints show global config, not per-org

#### Gap 6: Webhook Processing Not Fully Org-Scoped
- Signature verification tries ALL realm secrets (not scoped to org)
- `resolveLinearApiKey()` accepts orgId but most callers hardcode "default"
- Webhook forwarding to machines doesn't carry org context

---

## Implementation Plan

### Phase 1: Org Resolution & Auth Context (Foundation)

**Goal:** Every request knows which org it belongs to. This is the prerequisite for everything else.

#### 1.1 Add Better Auth Organization Plugin
**File:** `src/better-auth.ts`
- Integrate `better-auth`'s organization plugin (or implement custom org association)
- Each user gets associated with an org at sign-up or invite time
- Session carries `orgId` alongside userId

#### 1.2 Fix Org Resolution in Cloud
**File:** `cloud/src/org-auth.ts`
- Replace hardcoded `"default"` with actual org lookup from session
- Use Better Auth's org plugin to resolve which org the authenticated user belongs to
- Fallback to "default" only for unauthenticated or simple-auth mode

#### 1.3 Add orgId to AuthContext
**File:** `src/auth.ts`
- Add `orgId: string` to `AuthContext` interface
- Propagate orgId through `getAuthContext()` → `getBetterAuthSession()` → session org lookup
- Update `requireAuth()` to include orgId in returned context
- All auth-gated endpoints now have access to the requesting user's org

#### 1.4 Pass orgId Through Request Pipeline
**File:** `src/create-server.ts`
- Replace scattered `getRequestOrgId(url)` calls with a single org resolution at the top of the request handler
- For webhook URLs (`/webhook/:orgId`), use the URL-extracted org
- For authenticated API requests, use the auth context's orgId
- Store resolved orgId for use throughout the request lifecycle

**Files affected:** `src/create-server.ts`, `src/auth.ts`, `cloud/src/org-auth.ts`, `src/better-auth.ts`

---

### Phase 2: Per-Org Configuration

**Goal:** Each org loads and maintains its own configuration (realms, projects, global settings).

#### 2.1 Replace Global Config Singletons with Per-Org Config Cache
**File:** `src/config.ts`
- Replace `CONFIG` and `REALM_CONFIG` global singletons with a `Map<string, ResolvedConfig>` (orgId → config)
- New `getOrgConfig(orgId: string)` function that:
  - Returns cached config if available
  - Otherwise loads from Postgres (DB realms + global YAML)
  - Caches in memory with a TTL or invalidation mechanism
- Keep backward-compatible `CONFIG` getter that defaults to "default" org for standalone/machine mode

#### 2.2 Per-Org Config Initialization
**File:** `src/config.ts`
- `initConfig()` now loads config for a specific org (or "default" for standalone)
- In hub/cloud mode, configs are loaded lazily when an org's webhook arrives or a user accesses the dashboard
- Each org gets its own realms, secrets, projects, trigger states, etc.

#### 2.3 Per-Org Webhook Secrets
**File:** `src/config.ts`
- `getAllWebhookSecrets()` becomes `getOrgWebhookSecrets(orgId)`
- Webhook signature verification only checks the requesting org's secrets
- This also improves security — no cross-org secret leakage

**Files affected:** `src/config.ts`, `src/config-loader.ts`

---

### Phase 3: Per-Org Hub Components

**Goal:** Hub-mode components (MachineRegistry, webhook routing, idle scanning) are org-scoped.

#### 3.1 Org-Scoped Machine Registry
**File:** `src/hub/registry.ts`
- `MachineRegistry` stores machines in a nested structure: `Map<orgId, Map<machineName, Machine>>`
- Or: create a `PerOrgMachineRegistry` that wraps per-org instances
- `loadFromDb()` filters by orgId
- `register()`, `get()`, `getAll()`, `updateStatus()` all take orgId

#### 3.2 Org-Scoped Heartbeat Reception
**File:** `src/create-server.ts` (heartbeat handler)
- Machine heartbeats authenticate and resolve their org
- `authenticateMachine()` already returns `orgId` — use it to scope the registry update
- Hub status endpoint (`/hub/status`) returns only the requesting org's machines

#### 3.3 Org-Scoped Webhook Routing
**File:** `src/hub/router.ts`, `src/db/routing.ts`
- `routeWebhook()` already takes orgId — ensure callers pass the correct one (from `/webhook/:orgId`)
- Each org's webhooks only route to that org's machines

#### 3.4 Org-Scoped Idle Scanner
**File:** `src/hub/idle-scanner.ts`
- Scanner iterates per-org machine registries
- Or: single scanner that pulls machines from all orgs but respects org boundaries for actions

**Files affected:** `src/hub/registry.ts`, `src/hub/router.ts`, `src/hub/idle-scanner.ts`, `src/create-server.ts`

---

### Phase 4: Per-Org Agent Execution

**Goal:** Agents are org-scoped. Each org's agents are isolated.

#### 4.1 Org-Aware Orchestrator
**File:** `src/orchestrator.ts`
- **Option A (simpler):** Add orgId to agent keys and the agents Map. Single orchestrator instance, but all operations are org-filtered.
  - `getAgentKey()` → `${orgId}:${projectKey}-${issueId}`
  - `getStatus(orgId)` → filters agents by org
  - `startAgent()` takes orgId parameter
- **Option B (more isolated):** Per-org orchestrator instances. Hub creates one orchestrator per active org.
  - More isolation but more complexity
  - Better for resource accounting per org

**Recommendation:** Start with Option A (single orchestrator, org-aware keys). Simpler, can migrate to Option B later if needed.

#### 4.2 Org Context in Agent Lifecycle
**Files:** `src/orchestrator.ts`, `src/create-server.ts`
- `handleIssueWebhook()` passes orgId to orchestrator
- `handleCommentWebhook()` passes orgId to orchestrator
- Agent completion callbacks include orgId for correct DB writes
- `resolveLinearApiKey()` receives correct orgId (not "default")

#### 4.3 Org-Scoped Persistence
**File:** `src/persistence.ts`
- Add `org_id` column to SQLite `agents` and `completed_tasks` tables
- All queries filter by orgId
- Migration adds the column with "default" as default value

**Files affected:** `src/orchestrator.ts`, `src/persistence.ts`, `src/create-server.ts`

---

### Phase 5: Per-Org Dashboard & API

**Goal:** Each org only sees their own data.

#### 5.1 Org-Scoped Status Endpoints
**File:** `src/create-server.ts`
- `/status` — returns only the requesting org's agents
- `/hub/status` — returns only the requesting org's machines
- `/status/history` — already scoped by orgId in queries, just needs correct orgId from auth

#### 5.2 Org-Scoped Hub API
**File:** `src/hub/api.ts`, `src/create-server.ts`
- Hub API endpoints already receive orgId — verify callers pass the auth-resolved orgId
- Users, projects, realms, machines: all scoped to the authenticated user's org
- Admin operations limited to the user's own org

#### 5.3 Org-Scoped Config Endpoints
**File:** `src/create-server.ts`
- `/config` — returns the requesting org's config
- `/config/yaml` — returns the requesting org's YAML
- Config save/reload operates on the requesting org

**Files affected:** `src/create-server.ts`, `src/hub/api.ts`

---

### Phase 6: Per-Org Webhooks

**Goal:** Each org gets a unique webhook URL. Linear webhooks are routed to the correct org.

#### 6.1 Webhook URL Pattern
- URL format: `/webhook/:orgId` (already supported by `getRequestOrgId()`)
- Each org configures their Linear webhook to: `https://hub.example.com/webhook/<their-org-id>`
- The orgId in the URL determines which org's secrets and config to use

#### 6.2 Webhook Signature Verification
**File:** `src/create-server.ts`
- After extracting orgId from URL, only verify against that org's webhook secrets
- Reject if orgId doesn't exist or has no secrets configured
- The `/webhook` path (no orgId) continues to work for "default" org / standalone mode

#### 6.3 Webhook Forwarding
**File:** `src/create-server.ts`
- When forwarding to machines, include orgId in the forwarded payload
- Machine authenticates with hub using org-scoped API key
- Machine processes webhook in the context of the correct org

**Files affected:** `src/create-server.ts`, `src/org.ts`

---

### Phase 7: Cloud Onboarding & Org Lifecycle

**Goal:** New orgs can self-service through onboarding.

#### 7.1 Org Creation
**File:** `cloud/src/org-auth.ts`, `cloud/src/onboarding.ts`
- New user sign-up creates a new org (or joins existing via invite)
- Org gets a unique `org_id` (UUID or slug)
- Onboarding wizard creates the org's realms, secrets, and initial config

#### 7.2 Per-Org Onboarding State
**File:** `cloud/src/db/cloud-db.ts`
- Onboarding state already scoped by orgId — just ensure correct resolution

#### 7.3 Org Webhook URL Display
- During onboarding, display the org's unique webhook URL
- `https://hub.example.com/webhook/<org-id>`

**Files affected:** `cloud/src/org-auth.ts`, `cloud/src/onboarding.ts`

---

## Migration Strategy

### Backward Compatibility
1. **Standalone mode** continues to use "default" org — no changes needed
2. **Machine mode** continues to use local YAML — no multi-tenancy needed
3. **Hub/Cloud mode** gets full multi-tenancy

### Data Migration
1. All existing data is already under `org_id = 'default'`
2. No schema changes needed (columns already exist)
3. SQLite persistence needs a migration to add `org_id` column

### Phased Rollout
- Phases 1-2 can be done independently (foundation)
- Phases 3-5 build on Phase 1-2 (org-scoped operations)
- Phase 6 can be done in parallel with Phase 3-5
- Phase 7 is cloud-only and can come last

---

## Resolved Decisions

1. **Org identity model:** **Slug-based.** Webhook URLs use slugs (`/webhook/acme`). Uniqueness enforced at DB level.

2. **User-to-org mapping:** **No multi-org users.** Each user belongs to one org. The same email can exist across different orgs (a Better Auth concern, not ours).

3. **Machine sharing:** **No.** Machines are single-org. Each machine serves exactly one org.

4. **Standalone mode:** **Stays single-tenant.** No multi-tenant support needed for standalone.

5. **Org-level quotas:** **None.** No agent/machine quotas per org.

6. **Existing "default" org migration:** **Yes, migrate.** When the first real org is created, existing "default" data can be migrated to it.

---

## Estimated Scope

| Phase | Files Changed | Complexity | Dependencies |
|-------|--------------|------------|--------------|
| Phase 1: Auth & Org Resolution | ~5 files | Medium | None |
| Phase 2: Per-Org Config | ~3 files | Medium | Phase 1 |
| Phase 3: Per-Org Hub | ~5 files | Medium | Phase 1-2 |
| Phase 4: Per-Org Agents | ~3 files | High | Phase 1-2 |
| Phase 5: Per-Org Dashboard | ~2 files | Low | Phase 1-4 |
| Phase 6: Per-Org Webhooks | ~2 files | Low | Phase 1-2 |
| Phase 7: Cloud Onboarding | ~3 files | Medium | Phase 1-6 |

**Total: ~20 files, spread across 7 phases**

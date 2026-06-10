# Amadeus Repository Audit — 2026-06-10

Auditor: Claude Code (principal-engineer-level repo audit). Read-only analysis; no code modified.
Method: full directory/manifest/docs review, manual reading of entry points and security-critical paths, four parallel deep-dive audits (security, code quality/architecture, testing, deps/devex/perf), test suite + `tsc --noEmit` + `bun outdated` actually executed. Every Critical/High finding was verified against source; file:line citations throughout.

---

## 1. Executive Summary

**Overall health: C−.** Amadeus is a genuinely working, thoughtfully documented agent-orchestration system with real test investment (582 tests) and correct security fundamentals in its webhook layer — but it is held back by the absence of any quality gate (no CI, 61 failing tests, 35 `tsc` errors nobody sees), two unauthenticated admin surfaces in the cloud layer, and heavy structural debt concentrated in a 1,513-line god file. The standalone/solo-dev mode is in decent shape; the `cloud/` multi-tenant ambition is where the grade collapses, because its trust boundary is documented in a comment but not implemented in code.

**Top 3 risks:**
1. **Unauthenticated cloud admin/onboarding routes** — anyone reaching a cloud deployment can mint machine API keys and overwrite the org's Linear credentials (`cloud/src/cloud-handler.ts:16-34`, `cloud/src/admin.ts:19-53`).
2. **No CI + red test suite + failing typecheck** — regressions land silently; the suite has already drifted to 61 failures without anyone noticing, including 5 auth-expectation failures that may mask a real auth gap.
3. **Unsandboxed agents + unsanitized Linear content + full env inheritance** — prompt injection from an issue body is arbitrary code execution with all host secrets in the agent's environment (`src/prompt.ts:35-41`, `src/orchestrator.ts:487-505`).

**Top 3 opportunities:**
1. A one-day CI + test-hermeticity fix converts the existing 582-test investment from decoration into a regression net.
2. Deleting the duplicated/dead transport layer (HTTP heartbeat fallback, dead `src/machine/`+`src/hub/index.ts` shims, unused `stopForIdle`) removes ~500 lines and one of three parallel heartbeat mechanisms at near-zero risk.
3. Splitting `create-server.ts` into route modules makes the main router testable for the first time (currently 13.8% line coverage on the most important file in the repo).

---

## 2. Repo Map

**Purpose:** AI agent orchestration using Linear/GitHub as the control plane. Moving a Linear issue to a trigger state fires a webhook; Amadeus spawns a Claude Code (or Codex) agent via [AgentAPI](https://github.com/coder/agentapi) in an isolated git worktree; the agent works the issue, updates Linear state, and opens a PR. A dashboard monitors and chats with agents.

**Stack:** Bun + TypeScript throughout. React 19 + Tailwind 3 dashboards (Bun HTML imports, no Vite). Postgres via `Bun.sql` (hub) + SQLite via `bun:sqlite` (machine persistence). `better-auth` for sessions. Zod 4 config validation. One Cloudflare Worker (`amadeus-router/`).

**Runtime modes:** one codebase, three modes (`standalone` | `hub` | `machine`), selected by `global.runtimeMode` in `amadeus.config.yaml`. Hub receives webhooks + routes to machines over WebSocket; machines run agents and heartbeat back; standalone does both in one process.

**Maturity:** solo-developer production tool (375 commits since 2026-01-09, actively used daily) with early-stage multi-tenant SaaS aspirations in `cloud/`. Apache-2.0, private.

**Key directories:**

| Path | What it is |
|---|---|
| `src/server.ts` | Entry point/composition root (785 lines, side-effecting) |
| `src/create-server.ts` | The entire HTTP API as one 1,513-line factory function |
| `src/orchestrator.ts` | Agent lifecycle: spawn agentapi subprocess, worktrees, prompts (893 lines) |
| `src/config.ts` + `src/config-schema.ts` | YAML→Zod→Postgres-seeded config; global mutable singletons |
| `src/hub/` | Hub-side: machine registry, WS connections, webhook router, idle scanner |
| `src/db/` | Postgres data layer (orgs, realms, projects, machines, secrets) — parameterized `Bun.sql` |
| `src/persistence.ts` | Machine-side SQLite agent/task persistence |
| `src/prompt.ts` | Agent prompt templating (best-tested module: 95%) |
| `src/dashboard/` | React dashboard #1 |
| `cloud/` | Multi-tenant SaaS wrapper: better-auth sessions, onboarding wizard, machine key admin, React dashboard #2 (fork of #1) |
| `amadeus-router/` | Cloudflare Worker webhook router (its 38 tests are fully green) |
| `agent-profiles/` | JSON agent profiles (permissions, skills, prompt additions) |
| `docs/plans/`, `docs/design/` | Dated design/implementation docs — a real strength |
| `scripts/` | Machine setup, Sprites provisioning |

**Surprises found during mapping:**
- No `.github/` directory at all — zero CI for a 28k-line, 375-commit project.
- `src/machine/orchestrator.ts`, `src/hub/index.ts`, `src/shared/linear.ts` are dead re-export shims with zero importers — the directory layout advertises a mode split that was abandoned.
- README still points to a separate `amadeus-cloud` repo (`README.md:261-266`) although `cloud/` was vendored in.
- The dashboard "WebSocket real-time messages" feature (commit 8b8ee37) is actually a server-side 1-second poll per subscription.

---

## 3. Audit Report

Severity legend: **C**ritical / **H**igh / **M**edium / **L**ow. Each finding labeled FACT (verified in code/output) or JUDGMENT.

### 3.1 Security

| # | Sev | Finding |
|---|---|---|
| S1 | **C** | **Cloud admin & onboarding routes have no authentication.** `createCloudHandler` resolves org as `(await resolveOrgId(req)) ?? "default"` — an unauthenticated request silently becomes org `"default"` — then dispatches to `handleOnboardingRoutes`/`handleAdminRoutes` with no session check (`cloud/src/cloud-handler.ts:16-23`; `cloud/src/org-auth.ts:7-21`; `cloud/src/admin.ts:19-53`; `cloud/src/onboarding.ts:47-114`). An anonymous attacker can `POST /cloud/admin/machines` to mint machine API keys, regenerate/delete machine keys, and `POST /cloud/onboarding/linear` to overwrite the Linear API key + webhook secret. The comment at `cloud-handler.ts:26-27` claims "requests reaching here have already passed cloud-level auth" — that is false. FACT (independently verified). |
| S2 | **C** | **`/hub/api/*` admin auth bypass via token self-injection.** The same unauthenticated cloud handler injects `X-Amadeus-Token: $AMADEUS_API_TOKEN` into any `/hub/api/*` request lacking one (`cloud/src/cloud-handler.ts:28-34`), which then passes `requireAdmin`. When the env var is set, every hub admin endpoint (user CRUD, PAT set/delete, project/realm/machine management) is open to anonymous callers. FACT. |
| S3 | **H** | **Unauthenticated dashboard WebSocket streams agent conversations.** `/ws/dashboard` upgrades with `authenticated:false` (`src/server.ts:624-637`) and `handleDashboardWsMessage` (`src/server.ts:470-516`) never checks auth before honoring `subscribe-messages`. The equivalent HTTP route is gated by `requireViewer`; the WS path bypasses it for any reachable client, regardless of `publicDashboard`. Duplicated in `cloud/src/server.ts:313-347, 466-478`. FACT. |
| S4 | **H** | **Hub restart disables machine-endpoint auth.** `MachineRegistry.loadFromDb()` registers machines with `apiKey: undefined` (`src/hub/registry.ts:205-209`); `/hub/heartbeat` checks `else if (machine.apiKey && machine.apiKey !== token)` (`src/create-server.ts:933`) and `/hub/agent-complete` accepts `if (!machine.apiKey || ...)` (`src/create-server.ts:981-984`). After any hub restart, unauthenticated POSTs with a known machine name can spoof status, inject fake completions, and drain queued stop commands. FACT. |
| S5 | **H** | **All secrets stored plaintext in a column named `encrypted_val`.** Linear API keys, PATs, webhook secrets, machine keys written verbatim (`src/db/schema.sql:25`; `src/db/index.ts:119-134`; `cloud/src/api-keys.ts:23,36` — comment literally says "Store plaintext key as secret"; `cloud/src/onboarding.ts:63-64`; `src/hub/api.ts:65,271,304`). Any DB dump/backup exposure leaks every customer credential; the column name implies protection that doesn't exist. FACT. |
| S6 | **H** | **Open self-registration grants viewer API access.** `emailAndPassword.enabled=true` (`src/better-auth.ts:22-24`); any valid session gets `authenticated:true` with default role `viewer` even if not an org member (`src/auth.ts:83-103`); `requireViewer` (`src/create-server.ts:625-635`) checks only that. The "accessDenied" gate exists only in `/auth/me` UI logic (`create-server.ts:807-814`). Self-registered strangers can read `/status`, `/config`, `/config/yaml`, and agent messages. FACT for the mismatch; JUDGMENT on intent (commit 657b5fd suggests login was meant to be restricted). |
| S7 | **H** | **Prompt injection → unsandboxed code execution with host secrets.** Issue title/description interpolated unsanitized into the prompt (`src/prompt.ts:35-41`); agents run `--dangerously-skip-permissions` / Codex `--dangerously-bypass-approvals-and-sandbox` (`src/orchestrator.ts:487-489`; commit c1e69cb removed the sandbox); spawn inherits the full host env including `DATABASE_URL`, `BETTER_AUTH_SECRET`, all `LINEAR_API_KEY_*` (`src/orchestrator.ts:496-505`). Anyone who can file/comment on a Linear issue can execute arbitrary code on the machine and read its secrets. Largely inherent to the product, but the env inheritance and sandbox removal widen it materially. FACTs; risk framing JUDGMENT. |
| S8 | M | **Telegram webhook unauthenticated** — `POST /telegram-webhook` verifies nothing (Telegram supports a secret-token header) and posts comments to Linear as the bot (`src/create-server.ts:1411-1452`). FACT. |
| S9 | M | **Machine mode defaults to a fully open control plane.** Without better-auth, `getSecurityConfig` forces `publicDashboard:true` + `enableAgentMessaging:true` (`src/config.ts:466-481`) and `requireOperator` then skips auth entirely (`src/create-server.ts:637-647`): `/trigger`, `/agents/:key/stop` open to anyone who reaches the port. Relies on an undocumented Tailscale network-trust assumption. FACT. |
| S10 | M | **Multi-tenancy is not real.** Org `"default"` hardcoded across cloud and hub paths (`cloud/src/org-auth.ts:15`, `cloud/src/server.ts:110,135`, `src/create-server.ts:791-826`); all "tenants" share one secret/machine namespace. FACT. |
| S11 | L | TLS verification disabled on hub→machine webhook forwarding (`tls: { rejectUnauthorized: false }` at `src/create-server.ts:530`, `curl -skv` at `:535`) — forwarded payloads include the resolved Linear API key. Intentional for Tailscale certs, but applies to all targets. FACT. |
| S12 | L | Router secret compared with `!==` instead of constant-time (`amadeus-router/src/index.ts:100,117,154`), inconsistent with the timing-safe Linear signature path. FACT. |

**Security done well (FACTs):** Linear webhook HMAC-SHA256 with `crypto.timingSafeEqual` + 60s replay window (`src/signature.ts:6-32`, `src/create-server.ts:718-725`); machine API keys hashed (SHA-256) on the auth lookup path (`src/db/index.ts:95-103`); **no SQL injection found** (all queries are parameterized `Bun.sql` tagged templates) and **no command injection found** (all shell calls use Bun `$`/`Bun.spawn` array form with regex-constrained identifiers); loud startup warning when no auth is configured (`src/server.ts:779-785`).

### 3.2 Testing & Quality Gates

| # | Sev | Finding |
|---|---|---|
| T1 | **C** | **No CI of any kind.** No `.github/`, no other CI config, no git hooks; `bun test` runs only when someone remembers. With 61 tests currently failing, drift is already proven. FACT. |
| T2 | **H** | **Suite is red: 521 pass / 61 fail.** Three root causes, all environmental, none product bugs per se: (a) 40 failures — DB tests hard-require local Postgres with matching credentials, no skip-gate; (b) 16 failures — `tests/worktree.test.ts` + `src/orchestrator-agent.test.ts` run real `git commit` which hangs on machines with `commit.gpgsign=true` (verified by reproduction); (c) 5 failures — `tests/server.test.ts` imports the real `src/server.ts`, which loads the developer's real `amadeus.config.yaml` and binds a real port. FACT. |
| T3 | **H** | **The 5 server-test failures are auth expectations returning the wrong way** — e.g. `GET /status` without token expected 401, got **200** (`tests/server.test.ts:69,229,267`). Probably local-config bleed-through, but until verified this may be a live auth gap (consistent with S9). FACT (failures); JUDGMENT (cause). |
| T4 | **H** | **`tsc --noEmit` fails with 35 errors; no `typecheck` script exists.** Real product-path errors include `src/server.ts:239` (webhook replay `.catch` on a possibly-non-Promise), and `src/server.ts:583` + `src/create-server.ts:1007` (`string` not assignable to `CompletionReason` on the completion-ingest path). FACT. |
| T5 | **C/H** | **Coverage inverts importance.** Overall 65.5% funcs / 61.7% lines, but: `src/create-server.ts` **13.8% lines** (its own test file's first describe block re-implements the logic inline and asserts on the copy — tautological; only 4 of ~20 routes exercised); `src/orchestrator.ts` 30.4% — the spawn/stop/exit-handler lifecycle (lines 325-674) has zero coverage; `src/server.ts` WS handlers 0%. Meanwhile `src/prompt.ts` is at 94.8%. FACT. |
| T6 | M | `src/integration.test.ts` is integration in name only (39 lines of "exports are defined"); `tests/orchestrator.test.ts` contains filler assertions (`expect(orch).toBeDefined()`, asserting a literal's own field). FACT. |

**Testing strengths (FACTs):** 582 tests across 60 files in 82s; genuinely strong suites — `tests/auth.test.ts` (secure-by-default assertions), `tests/prompt.test.ts`, `src/hub/api.test.ts` (real-DB CRUD with cleanup), `amadeus-router` fully green; disciplined fetch-mock save/restore; mock agentapi on port 0.

### 3.3 Architecture & Code Quality

| # | Sev | Finding |
|---|---|---|
| A1 | **H** | **`src/create-server.ts` is a 1,513-line god file**: `createFetchHandler()` returns one ~855-line closure (`:658-1512`) hand-routing 22+ method branches covering webhook auth, hub forwarding (3 transports), Linear GraphQL, better-auth session + first-user bootstrap inlined in `/auth/me` (`:782-845`), heartbeat ingest, three proxies, PAT self-service, entity CRUD dispatch, config CRUD, Telegram, and agent control. Every concern is coupled through one closure over global config; this is why it's untestable (T5). Size FACT; "split it" JUDGMENT. |
| A2 | **H** | **Workspace-specific magic values in product code.** `DONE_STATE_ID = "edbec4af-..."` — one workspace's Linear state UUID — drives PR-merge→Done automation (`src/server.ts:343`, used `:385`); silently no-ops for any other workspace even though `fetchTeamWorkflowStates` already exists. The workspace slug `ona` is hardcoded into PR-body links in `DEFAULT_PROMPT_TEMPLATE` (`src/prompt.ts:292`). FACT. |
| A3 | **H** | **`reason as any` smuggles invalid completion reasons.** `stopAgent(agentKey, reason as any)` (`src/server.ts:223,286`); the idle scanner sends `"idle"` (`:326,335`) which isn't in `CompletionReason` (`src/orchestrator.ts:26`), so worktree cleanup misclassifies it (`src/orchestrator.ts:870`) and an unrecognized reason is persisted. Related to the T4 type errors. FACT. |
| A4 | M | **Machine→hub transport duplicated.** `src/hub-connection.ts` (WS, 364 lines) vs `src/hub-heartbeat.ts` (HTTP, 193 lines): ~120 of the HTTP file's lines restate WS logic (same constants, adaptive-interval state machine, `reportCompletion`); both are wired in parallel everywhere (`src/server.ts:85-86,124-125,183-184`). The hub keeps both a WS heartbeat handler and an HTTP one plus a stop-command drain queue labeled "backward compatibility during migration" (`src/server.ts:564`, `src/create-server.ts:941`) with no removal plan. Three heartbeat mechanisms total (incl. `router-heartbeat.ts`). Bonus: `HubConnection.stopForIdle` (`hub-connection.ts:321-330`) is unreachable dead code. FACT. |
| A5 | M | **Completion-record literal copy-pasted 4×** (`src/server.ts:87-97`, `:99-111`, `:576-586`; `src/create-server.ts:1000-1010`) — two of these sites are where the T4 type errors live. FACT. |
| A6 | M | **Two forked React dashboards + forked server bootstrap.** `src/dashboard/` vs `cloud/src/dashboard/` share drifted components (ProjectsTab 624 vs 447 lines, 349 diff lines); `cloud/src/server.ts` re-implements IdleScanner wiring, `fetchMessages`, and WS handlers from `src/server.ts`. Fixes (e.g. S3) must land twice. FACT. |
| A7 | M | **Dead modules:** `src/machine/index.ts`, `src/machine/orchestrator.ts`, `src/hub/index.ts`, `src/shared/linear.ts` have zero importers — abandoned mode-split scaffolding that misleads readers about the architecture. FACT. |
| A8 | M | **43 bare `catch {}` blocks**, clustered on user-visible paths: `fetchMessages` returns `[]` on any error so the dashboard shows an empty conversation indistinguishable from "no messages" (`src/server.ts:444-467`); `/auth/me` catches everything → `{authenticated:false}`, making a Postgres outage look like a logout (`src/create-server.ts:842-844`); webhook handling is fire-and-forget with no failure surfaced back to the Linear issue (`src/create-server.ts:769-773`). FACT (counts/locations). |
| A9 | M | **Global mutable config singletons + scattered mode branching.** `export let CONFIG` / `REALM_CONFIG` reassigned by init/reload (`src/config.ts:216,222,349-402,651-671`); `isHubMode()/isMachineMode()/isStandaloneMode()` re-decided at ~57 call sites instead of once at composition; `createFetchHandler` snapshots some config at creation while other paths re-read live — reload semantics are inconsistent. FACT for mechanics; impact JUDGMENT. |
| A10 | M | **`verifyLinearSignature` and `postLinearComment` each implemented twice** with divergent strategies (`src/signature.ts:6-32` vs `amadeus-router/src/linear.ts:42-71`; `src/create-server.ts:574-589` vs router) — a security fix to one copy won't reach the other. FACT. |
| A11 | M | **`startAgent` is a 207-line do-everything method** (`src/orchestrator.ts:387-593`): routing → profile merge → port alloc → worktree → trust-file mutation → spawn → readiness poll → Linear ack → image download → comment fetch → prompt send. The core product path is testable only end-to-end. FACT (length); JUDGMENT (decomposition). |
| A12 | L | Port allocation is a naked monotonic counter from 8001 with no availability check or recycling (`src/orchestrator.ts:89,433`). FACT. |
| A13 | L | `src/server.ts` is a 785-line side-effecting entry script (top-level await, `Bun.serve` at import, `process.exit` in shutdown) — `tests/server.test.ts` importing it is the direct cause of T2(c). FACT. |

### 3.4 Performance

| # | Sev | Finding |
|---|---|---|
| P1 | **H** (at scale) | **Dashboard message subscriptions re-fetch and resend the full transcript every 1s per (browser, agent)** — no cursor/diff; each tick can traverse browser←hub←machine←agentapi (`src/server.ts:493-504,438-468`). Fine for one user with small transcripts (JUDGMENT); non-incremental design is FACT. Mitigations: timer cleanup on unsubscribe/close is correct. |
| P2 | L | Heartbeats spawn one `ps` per agent every 2s for memory stats (`src/process-memory.ts:15` via `getStatusWithMemory`); batchable into one `ps` call. Adaptive 2s→60s idle backoff already exists (good). FACT. |
| P3 | L | `completed_tasks` SQLite table grows forever (no DELETE/pruning; `src/persistence.ts:62-74`); hub `pendingStopCommands` persists in memory for machines that never return (`src/hub/registry.ts:31,173`). Slow growth; years from mattering. FACT. |
| P4 | — | All other polling loops (health 30s, idle scan 60s, reconcile 60s, PR check 5min, pending-message 2s) are tiered sensibly and all interval handles are stored and cleared. Healthy. FACT. |

### 3.5 Dependencies

| # | Sev | Finding |
|---|---|---|
| D1 | M | `better-auth` 1.4.18 → 1.6.16 behind in root and cloud — the security-critical dependency. FACT. |
| D2 | M | `pg` used (`src/better-auth.ts:5`) despite the repo's own CLAUDE.md mandating `Bun.sql` — two Postgres pools against one DB. Likely forced by better-auth's adapter (JUDGMENT); deserves a documented exception. FACT. |
| D3 | M | `wrangler` a full major behind (3.114 → 4.99) in amadeus-router. FACT. |
| D4 | L | `@types/pg` in `dependencies` not `devDependencies` (`package.json:48`); three independent lockfiles already drift (react 19.2.3 vs 19.2.4, bun-types ×3); `tailwindcss: "3"` held back without comment. No known-CVE deps spotted, but no `bun audit` runs anywhere. FACT. |

### 3.6 DevEx, Operations & Documentation

| # | Sev | Finding |
|---|---|---|
| O1 | **H** | No lint or format config anywhere; no `typecheck` script. Combined with T1: zero automated quality gates on a 28k-line codebase. FACT. |
| O2 | M | Observability = 286 raw `console.*` calls with `[Tag]` prefixes; no levels, no structured output, no error reporting. The owner's own memory notes "agent hangs"/"machine not connected" as recurring ops pains diagnosed by `tail -f /tmp/amadeus.log`. FACT. |
| O3 | M | No deployment story: `.dockerignore` exists but no Dockerfile; crash recovery is "restart `bun run dev` by hand". FACT. |
| O4 | M | README points to external `amadeus-cloud` repo though `cloud/` is vendored (`README.md:261-266`); `.env.example` documents ~14 vars while code reads ~35, with confusing near-duplicates (`AMADEUS_API_KEY` vs `AMADEUS_API_TOKEN`, `LINEAR_API_KEY` vs `LINEAR_TOKEN`); cloud/ has no `.env.example`. FACT. |
| O5 | L | Secrets/operational detail in logs (heartbeat auth detail, curl args incl. header values: `src/create-server.ts:540,547,921`). FACT. |

### 3.7 Strengths worth preserving

1. **Dated design-doc culture** — `docs/plans/` and `docs/design/` hold 12 `YYYY-MM-DD-*` design/implementation pairs. Rare and valuable; this audit follows the convention.
2. **`ABOUTME:` two-line headers on every file** and exceptional "why" comments on non-obvious hacks (trust-file atomic writes `src/orchestrator.ts:792-797`, agentapi splash workaround `:475-485`).
3. **Typed WS protocol** — `src/ws-protocol.ts` discriminated unions with central `parseWsMessage`; the cleanest seam in the codebase.
4. **Config validation done right** — Zod schemas, `/config/validate` endpoint, validate-before-apply reload, YAML→DB seeding; example config matches the schema (spot-checked).
5. **Webhook security fundamentals** — HMAC + timing-safe compare + replay window; parameterized SQL everywhere; array-form shell calls everywhere.
6. **Real test investment** with several excellent suites (auth, prompt, hub API, router).

---

## 4. Improvement Strategy

### Theme 1: There is no safety net (explains T1–T5, O1, and the silent drift of A3/T4)
**Target state:** CI runs typecheck + the full suite on every push; the suite is green and hermetic (no dependence on the developer's git config, local YAML, or a specific Postgres password). **Principle:** an unenforced quality bar doesn't exist. Everything else in this plan is unsafe to do without this.

### Theme 2: The cloud trust boundary is a comment, not code (explains S1, S2, S3, S6, S10)
**Target state:** every mutating or data-revealing route — HTTP *and* WebSocket — passes through one explicit auth gate; the cloud handler enforces the session check its comment claims happened. **Principle:** authenticate at the boundary, once, explicitly; never default an unauthenticated request into a privileged identity (`?? "default"` is the root pattern behind S1/S2).

### Theme 3: Transitional duplication never got cleaned up (explains A4–A7, A10, M11, the three heartbeats)
**Target state:** one machine→hub transport (WS), one completion-record path, no dead shim modules, shared code actually shared. **Principle:** when a migration completes, delete the old path in the same quarter — "backward compatibility during migration" comments need expiry dates.

### Theme 4: The most important code is the least structured (explains A1, A11, T5)
**Target state:** `create-server.ts` decomposed into route modules behind a small router, each testable with an injected context; `startAgent` split into testable phases. **Principle:** test-shaped code — the reason coverage inverts importance is that the important code physically can't be unit-tested.

### Theme 5: Single-workspace assumptions are fossilized in code (explains A2, S10, parts of O4)
**Target state:** no Linear workspace UUIDs/slugs in source; state IDs resolved per team at runtime (the helper already exists). **Principle:** anything that differs between deployments is config or data, never a constant.

### Explicitly NOT recommended (trade-offs)
- **Don't unify the two dashboards now** (A6). It's an XL refactor with mostly aesthetic payoff while the cloud product is still finding its shape. Instead: document the fork and require security fixes to land in both.
- **Don't build real multi-tenancy yet** (S10). Until there's a second tenant, hardening the single-org cloud (Theme 2) is the right spend. Decide product intent first (see Open Questions).
- **Don't migrate Tailwind 3→4 or TypeScript 6** — pure churn at this maturity. Pin with a comment.
- **Don't adopt enterprise observability** (OTel etc.). A 50-line leveled logger wrapper + `bun audit` in CI is the right size for a solo project.
- **Accept the prompt-injection risk surface as product-inherent** (S7) but mitigate cheaply: pass a minimal env to agent processes instead of `...process.env`. Full sandboxing contradicts the product's purpose; env minimization doesn't.

### "Done" signals
- CI fails on: `tsc --noEmit` errors, any test failure, `bun audit` criticals. (Currently impossible: 35 errors, 61 failures.)
- `bun test` green on a fresh machine with no Postgres and gpg-signing enabled (DB tests skip with a message).
- Zero Critical findings: S1/S2 closed with route tests proving 401s.
- `/ws/dashboard` rejects unauthenticated subscribe (test exists).
- `grep -r "edbec4af" src/` and `grep -rn "linear.app/ona" src/` return nothing.
- `src/create-server.ts` < 400 lines; route modules individually ≥60% line coverage.
- One heartbeat path on machines; `src/machine/`, `src/hub/index.ts`, `src/shared/linear.ts` deleted.

---

## 5. Task Plan

### Milestone 0 — Safety net (do first; ~2-3 days)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M0.1 | **Add GitHub Actions CI**: `bun install`, `bun run typecheck`, `bun test` (3 packages), `bun audit`. Postgres service container for DB tests. | `.github/workflows/ci.yml`, `package.json` | CI runs on push/PR; red suite blocks merge (initially allow-failure on known-red jobs, flip to required as M0.2/M0.3 land) | S | None | — |
| M0.2 | **Make the suite hermetic**: `GIT_CONFIG_GLOBAL=/dev/null` (or `-c commit.gpgsign=false`) in git-using tests; skip-with-message gate on `DATABASE_URL` for DB suites; rework `tests/server.test.ts` to use `createFetchHandler` with injected config instead of importing `src/server.ts`. | `tests/setup.ts`, `tests/worktree.test.ts:26`, `src/orchestrator-agent.test.ts:324`, `tests/server.test.ts:37` | `bun test` green on a machine with gpgsign enabled and no Postgres | M | Low | — |
| M0.3 | **Fix 35 `tsc` errors; add `typecheck` script.** Includes fixing the `CompletionReason` breaches (A3): add `"idle"` to the union or map it, remove `reason as any`. | `package.json`, `src/server.ts:223,239,286,583`, `src/create-server.ts:1007`, `src/orchestrator.ts:26,870`, ~8 more files | `bunx tsc --noEmit` exits 0; CI enforces | M | Low — type-level, but the `"idle"` decision changes worktree-cleanup behavior; verify intent | M0.1 |
| M0.4 | **Investigate the 5 auth-expectation test failures** (`/status` returning 200 without token) — determine config-bleed vs. real gap (relates S9). | `tests/server.test.ts`, `src/config.ts:466-481` | Written conclusion; if real, fixed under M1 | S | None (read-only) | M0.2 |

### Milestone 1 — Critical security (~3-4 days)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M1.1 | **Session-gate the cloud handler** (S1+S2): require a valid session (or explicit `X-Amadeus-Token`) before onboarding/admin routes and before token injection; remove the `?? "default"` unauthenticated fallback when better-auth is enabled. | `cloud/src/cloud-handler.ts:12-37`, `cloud/src/org-auth.ts`, `cloud/src/admin.ts`, `cloud/src/onboarding.ts` | Tests: anonymous `POST /cloud/admin/machines` → 401; anonymous `/hub/api/users` → 401; authed flows still pass | M | Medium — could lock out simple-mode (no-auth) self-hosters; preserve the documented `AMADEUS_API_TOKEN` path | M0 |
| M1.2 | **Authenticate `/ws/dashboard`** (S3): validate session cookie/token at upgrade, or require an auth message before honoring `subscribe-messages`; apply in both `src/server.ts` and `cloud/src/server.ts`. | `src/server.ts:624-637,470-516`; `cloud/src/server.ts:313-347,466-478` | Test: unauthenticated WS `subscribe-messages` receives error/close, no message data | M | Low | M0 |
| M1.3 | **Close the hub-restart auth bypass** (S4): on heartbeat/agent-complete, authenticate against the DB hash (as the WS path already does) instead of the in-memory `apiKey`; reject when no credential proves identity. | `src/create-server.ts:891-1015`, `src/hub/registry.ts:205-209`, `src/db/index.ts:95-103` | Test: post-restart heartbeat without valid key → 401 | S | Low | M0 |
| M1.4 | **Resolve the registration/authz mismatch** (S6): disable open sign-up (invite/bootstrap-only, matching commit 657b5fd intent) or enforce org membership in `requireViewer`. | `src/better-auth.ts:22-24`, `src/auth.ts:83-103`, `src/create-server.ts:625-635` | Self-registered non-member gets 403 on `/status`, `/config` | S | Medium — first-user bootstrap flow must keep working | M1.1 |
| M1.5 | **Encrypt secrets at rest** (S5): AES-GCM with a `SECRETS_KEY` env var in `setSecret`/`getSecret`; migration script re-encrypts existing rows; or — minimum viable — rename the column and document plaintext storage as a known limitation. | `src/db/index.ts:119-134`, `src/db/schema.sql:25`, all `setSecret` callers | New secrets unreadable in raw dumps; round-trip tested; migration verified on a DB copy | L | Medium-High — touches every credential path; needs key-loss story | M0 |
| M1.6 | **Minimize agent env** (S7 mitigation): pass an allowlist (PATH, HOME, GH_TOKEN, agent-required vars) instead of `...process.env`. | `src/orchestrator.ts:496-505` | Agent process env contains no `DATABASE_URL`/`BETTER_AUTH_SECRET`/`LINEAR_API_KEY_*`; agents still function | S | Medium — easy to break agents that needed an unlisted var; roll out behind config flag | M0 |
| M1.7 | Telegram webhook secret-token check (S8). | `src/create-server.ts:1411-1452` | Requests without `X-Telegram-Bot-Api-Secret-Token` → 401 | S | Low | — |

### Milestone 2 — High-leverage structure (~1 week)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M2.1 | **Split `create-server.ts` into route modules** (A1): `routes/webhook.ts`, `routes/hub.ts`, `routes/auth.ts`, `routes/config.ts`, `routes/agents.ts`, `routes/telegram.ts` + a small dispatcher; auth helpers (`requireViewer`/`requireOperator`/`requireAdmin`) become explicit per-module middleware. | `src/create-server.ts` → `src/routes/*` | Behavior-preserving (existing tests + new route tests pass); no file >400 lines; webhook + hub-ingest routes gain direct tests | L | Medium — the webhook path is the product; do it incrementally, one route group per PR | M0 (tests are the safety net) |
| M2.2 | **Delete the legacy transport** (A4, A7): remove `hub-heartbeat.ts` HTTP path + hub-side drain queue + dead `stopForIdle`; delete `src/machine/index.ts`, `src/machine/orchestrator.ts`, `src/hub/index.ts`, `src/shared/linear.ts`. | `src/hub-heartbeat.ts`, `src/server.ts:270-296,564-568`, `src/create-server.ts:891-1015` (drain), dead shims | Machines connect via WS only; grep finds no `hubHeartbeat` references; suite green | M | Medium — confirm no deployed machine still lacks a WS token before removal | M1.3 |
| M2.3 | **Single completion-record constructor** (A5) shared by all 4 sites. | `src/server.ts`, `src/create-server.ts`, new `src/completion.ts` | One construction site; type-checked end to end | S | Low | M0.3 |
| M2.4 | **Remove workspace fossils** (A2): resolve Done-state per team via `fetchTeamWorkflowStates` (cache per team); template the `ona` slug from the `workspace` variable already passed to prompts. | `src/server.ts:343,385`, `src/prompt.ts:292` | Greps in §4 "done" signals return nothing; PR-merge→Done works against a non-ona workspace (or is integration-tested with a mock) | S | Low | M0 |
| M2.5 | **Test the agent lifecycle** (T5): extract `startAgent` phases (route→prepare worktree→spawn→handshake→brief) into testable units with a fake agentapi (the port-0 mock pattern already exists in `orchestrator-agent.test.ts`). | `src/orchestrator.ts:387-593` | Spawn-failure, readiness-timeout, and death-handler paths covered; `orchestrator.ts` ≥60% lines | L | Medium — core path; behavior-preserving extraction only | M2.1 optional, M0 required |
| M2.6 | **Incremental message delivery** (P1): add `since` cursor to message fetch, send only new messages; or push from machine on change. Apply to both servers. | `src/server.ts:438-516`, `cloud/src/server.ts`, `src/hub-connection.ts`, dashboard hooks | Steady-state subscription traffic is O(new messages), not O(transcript) | M | Medium — agentapi `/messages` API shape constrains; degrade gracefully to full fetch | M1.2 |

### Milestone 3 — Quality & polish (opportunistic)

| ID | Task | Areas | Acceptance | Effort | Risk |
|---|---|---|---|---|---|
| M3.1 | Leveled logger wrapper (debug/info/warn/error, JSON-optional) replacing raw `console.*`; keep `[Tag]` convention. | all of src/, cloud/src | `console.` grep ≈ 0 outside logger | M | Low |
| M3.2 | Docs truth pass: fix README amadeus-cloud reference; complete `.env.example` (+cloud one); kill or document `AMADEUS_API_KEY` vs `AMADEUS_API_TOKEN` and `LINEAR_API_KEY` vs `LINEAR_TOKEN`. | README.md:261, .env.example, src/config.ts | New-machine setup needs no tribal knowledge | S | None |
| M3.3 | Dep hygiene: bump better-auth + wrangler 4; move `@types/pg` to devDeps; comment the tailwind-3 pin; document the `pg` exception in CLAUDE.md. | package.json ×3 | `bun outdated` shows only intentional holds | S/M | Low (auth lib bump needs session-flow retest) |
| M3.4 | Narrow the 43 bare catches on critical paths: log with context; make dashboard distinguish "error fetching" from "no messages"; post a Linear comment on agent-spawn failure. | src/server.ts:444-467, src/create-server.ts:769-844 | Spawn failure visible in Linear; `/auth/me` 503s on DB outage | M | Low |
| M3.5 | Constant-time router secret compare; share `verifyLinearSignature` or sync the copies (A10, S12). | amadeus-router/src/index.ts | One implementation or documented divergence | S | Low |
| M3.6 | `completed_tasks` retention + batch `ps` call (P2, P3); port allocation availability check (A12). | persistence.ts, process-memory.ts, orchestrator.ts:433 | Pruning config; one fork per heartbeat | S | Low |
| M3.7 | Dockerfile + launchd/systemd template so machine crash-recovery isn't manual (O3 — also addresses the owner's recorded "restart bun run dev" pain). | new files, docs | Documented supervised deployment | M | Low |

### Quick wins (S effort, high impact — do immediately, any order)
- **M0.1** CI workflow — the single highest-leverage change in the repo.
- **M0.2 partial**: the one-line `GIT_CONFIG_GLOBAL=/dev/null` fix recovers 16 tests.
- **M1.3** hub-restart auth bypass — small diff, closes a High.
- **M1.7** Telegram secret token — ~10 lines.
- **M2.4** DONE_STATE_ID + `ona` slug — small diff, fixes silent breakage for every other workspace.
- **M3.2** README/`.env.example` truth pass.
- `@types/pg` → devDependencies (one-line).

### Implementation sketches — top 3 tasks

**M0.1 + M0.2 (CI + hermetic suite).**
Approach: land hermeticity first so CI starts meaningful. (1) In `tests/setup.ts`, set `process.env.GIT_CONFIG_GLOBAL = "/dev/null"` and `GIT_CONFIG_SYSTEM = "/dev/null"` — covers every test that shells out to git; verify worktree tests still find `user.name`/`user.email` (set them via env `GIT_AUTHOR_*`/`GIT_COMMITTER_*` in setup too). (2) Wrap DB suites: a shared helper `requireDatabase()` that probes `DATABASE_URL` once and calls `describe.skipIf` — Bun supports `describe.if`/`test.skipIf`. (3) `tests/server.test.ts`: replace `import "../src/server"` with `createFetchHandler(testCtx)` + `Bun.serve({ port: 0 })`; inject config via `AMADEUS_CONFIG_FILE` pointing at a fixture YAML so the developer's real `amadeus.config.yaml` can't bleed in. (4) CI: ubuntu runner, `oven-sh/setup-bun`, Postgres 16 service container with `DATABASE_URL` set (so DB tests *run* in CI even though they skip locally), three test jobs (root/cloud/router) + `bunx tsc --noEmit`. Gotchas: cloud/ and amadeus-router/ need their own `bun install`; the repo's `amadeus.config.yaml` is gitignored so CI naturally avoids the bleed-through that bites locally; keep typecheck job `continue-on-error: true` until M0.3 merges, then flip.

**M1.1 (cloud trust boundary).**
Approach: make the comment true. In `createCloudHandler`, compute `const session = await resolveSession(req)` (new function in `org-auth.ts` returning `{orgId, user} | null`). Gate: if path starts with `/cloud/admin/`, `/cloud/onboarding/`, or `/hub/api/` → require `session !== null` OR a valid `X-Amadeus-Token` (constant-time compare against `AMADEUS_API_TOKEN`) → else 401 JSON. Only inject the token header *after* that gate passes. Keep `?? "default"` solely for the better-auth-disabled self-host mode — i.e., when `auth` is null (`resolveOrgId`'s `if (!auth) return null` branch), preserve today's behavior, since simple-mode self-hosters authenticate with the token at the amadeus layer. Key steps: write the failing tests first (`cloud/tests/` has the harness; add anonymous-401 cases for each admin/onboarding route), implement, then audit `cloud/src/server.ts` for any sibling paths mounted outside the handler (the WS handlers are — that's M1.2). Gotcha: the onboarding wizard's first-ever-user flow must still work when no users exist yet — mirror the first-user bootstrap logic in `/auth/me` (`create-server.ts:796-815`) rather than inventing a second mechanism.

**M1.2 (dashboard WS auth).**
Approach: authenticate at upgrade time, where the cookie is available. In the `fetch` upgrade branch for `/ws/dashboard` (`src/server.ts:625-637`), call the same session resolution used by `requireViewer` (better-auth `getSession({headers})`, or token query-param fallback for simple mode) *before* `server.upgrade`; refuse the upgrade with 401 if it fails; stash `{authenticated: true, userId}` in `ws.data`. In `handleDashboardWsMessage`, early-return unless `ws.data.authenticated`. Honor `publicDashboard: true` by allowing it explicitly (so the standalone Tailscale use-case is unchanged — that's the intended config, not an accident). Apply the identical change in `cloud/src/server.ts:466-478` — and add a code comment in both noting the other copy exists (A6). Gotchas: `getSession` is async but Bun's `server.upgrade` must be called synchronously within `fetch` — resolve the session first, then upgrade (the handler is already async-capable since it returns a Response otherwise); WebSocket upgrades from browsers always carry cookies for same-origin, so no client change needed.

---

## 6. Open Questions (need human/product decisions)

1. **Is `cloud/` headed for real external tenants, and on what timeline?** This decides whether S10 (single hardcoded org) is a Medium or the next milestone, and whether M1.5 (secret encryption) is "nice" or mandatory before any external user.
2. **Is open self-registration intended** (S6/M1.4)? Commit 657b5fd ("Restrict login to pre-registered users only") suggests no — but the API path still allows it. Invite-only, or first-user-admin + closed?
3. **Can the HTTP heartbeat fallback be deleted** (M2.2)? Are there deployed machines/sprites without WS tokens that still depend on it?
4. **Are `src/machine/`, `src/hub/index.ts`, `src/shared/linear.ts` abandoned or a planned package split?** They look like a workspaces refactor that stalled — delete, or finish?
5. **What's the acceptable blast radius for prompt injection** (S7)? Env minimization (M1.6) is cheap; anything stronger (re-sandboxing Codex, network egress policy on Sprites) trades against the "no babysitting" product goal and needs an owner decision.
6. **Performance targets for the dashboard** (M2.6): how many concurrent viewers/agents should the 1s polling design survive? At "just me", P1 can stay; at team scale it can't.
7. **Dashboard fork** (A6): is `cloud/`'s dashboard meant to diverge (different product) or converge (shared components package)? Until decided, the policy "security fixes land in both" needs to be written down somewhere contributors will see it.

---

## 7. Review-depth note

Deep review: `src/` core (server, create-server, orchestrator, config, auth, hub/, db/, prompt), `cloud/src/` (handler, admin, onboarding, org-auth, api-keys), tests, manifests, docs. Lighter review: dashboard React components (both copies — reviewed for structure/duplication, not pixel-level logic), `amadeus-router/` (covered by its green suite + security spot-checks), `scripts/` (skimmed; `setup-machine.ts` read), `agent-profiles/` JSON (not audited for permission breadth — worth a future pass given profiles grant Bash allowlists to unsandboxed agents).

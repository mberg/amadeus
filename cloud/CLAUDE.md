Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Architecture

amadeus-cloud depends on amadeus (the open-source orchestrator) and wraps it with:
- Better Auth session-based authentication
- Guided onboarding wizard for new orgs
- Machine API key generation and registration
- Cloud-specific Postgres tables (onboarding_state)

The cloud server imports `createFetchHandler` from amadeus and wraps it
with org resolution middleware, mounting cloud-specific routes first.

## Local Development

amadeus-cloud reads `amadeus.config.yaml` from the amadeus root (its `file:..` dependency).

```bash
# Ensure amadeus has a config and local Postgres database set up
# (see amadeus/CLAUDE.md "Local Hub Development" section)

# Set DATABASE_URL in .env (not POSTGRES_URL — Bun.sql reads DATABASE_URL)
DATABASE_URL=postgres://localhost/amadeus_hub

# Start
bun run src/server.ts
```

Routes:
- `/dashboard` — amadeus dashboard (public if `publicDashboard: true`)
- `/cloud/setup` — auth-gated onboarding wizard
- `/hub/api/*` — hub entity management API
- `/cloud/onboarding/*` — onboarding state API

With Better Auth disabled (BETTER_AUTH_SECRET not set), use `AMADEUS_API_TOKEN` and
`X-Amadeus-Token` header for hub API access.

## APIs

- `Bun.serve()` for HTTP server
- `Bun.sql` for Postgres (shared schema with amadeus)
- `better-auth` for session-based authentication (server + client)

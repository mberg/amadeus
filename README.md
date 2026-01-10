# Amadeus

Amadeus uses Linear as a control plane to manage multiple Claude Code agents. Each agent runs on a dedicated port, working on different projects. Linear's Kanban board becomes the UI for orchestrating AI-powered development.

## Quick Start

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your Linear webhook secret and project paths

# Start the server
bun run src/server.ts

# Expose via Tailscale Funnel (in another terminal)
tailscale funnel --bg 3000
```

## Configuration

Set these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_WEBHOOK_SECRET` | Yes | Signing secret from Linear webhook settings |
| `PROJECT_PATHS` | No | Team-to-path mappings: `TEAM1:/path1,TEAM2:/path2` |
| `TRIGGER_STATES` | No | States that spawn agents (default: `Scoping,Ready to Build`) |
| `CLAUDE_BOT_USER_ID` | No | Linear user ID to trigger on assignment |
| `PORT` | No | Server port (default: 3000) |

## Endpoints

- `GET /health` - Health check
- `GET /status` - JSON status of all running agents
- `POST /webhook` - Linear webhook receiver
- `POST /trigger` - Manual agent message: `{"agentKey": "...", "message": "..."}`

## Linear Setup

1. Go to **Settings → API** in Linear
2. Create a new webhook pointing to `https://your-machine.ts.net/webhook`
3. Select events: Issues, Comments
4. Save the signing secret as `LINEAR_WEBHOOK_SECRET`

## Development

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch
```

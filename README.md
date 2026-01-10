# Amadeus

Amadeus uses Linear as a control plane to manage multiple Claude Code agents. Each agent runs on a dedicated port, working on different projects. Linear's Kanban board becomes the UI for orchestrating AI-powered development.

## How It Works

```
Linear Issue (status: "Scoping")
         │
         ▼ webhook
┌─────────────────────┐
│  Amadeus Server     │
│  (this project)     │
└─────────────────────┘
         │
         │ spawns
         ▼
┌─────────────────────┐
│  agentapi server    │──► Claude Code CLI
│  (port 8001+)       │    working in project dir
└─────────────────────┘
         │
         │ uses Linear MCP
         ▼
Linear Issue (status: "Building", comments, etc.)
```

1. **Webhook triggers**: When a Linear issue enters a trigger state (e.g., "Scoping"), Linear sends a webhook to Amadeus
2. **Agent spawns**: Amadeus runs `agentapi server claude --port <port> -- --dangerously-skip-permissions` in the configured project directory
3. **Prompt sent**: Amadeus sends the issue details to the agent via HTTP
4. **Claude works**: Claude Code analyzes the issue, updates Linear status via MCP, writes code, etc.
5. **Lifecycle managed**: When the issue is removed or done, Amadeus stops the agent

**Note:** Agents run with `--dangerously-skip-permissions` so they can work autonomously without prompting for approval. Review agent output in Linear before merging any code.

## Prerequisites

You need these installed on your machine:

1. **Claude Code CLI** - The `claude` command must be available
   ```bash
   # Verify installation
   claude --version
   ```

2. **AgentAPI** - HTTP wrapper for Claude Code ([github.com/coder/agentapi](https://github.com/coder/agentapi))
   ```bash
   # Install
   go install github.com/coder/agentapi@latest

   # Verify
   agentapi --help
   ```

3. **Linear MCP Server** - Each project needs Linear MCP configured so Claude can update issues
   ```json
   // .claude/mcp.json (in each project)
   {
     "mcpServers": {
       "linear": {
         "command": "npx",
         "args": ["-y", "@anthropic-ai/linear-mcp"],
         "env": {
           "LINEAR_API_KEY": "${LINEAR_API_KEY}"
         }
       }
     }
   }
   ```

4. **Tailscale** (optional) - For exposing webhooks to the internet via Funnel

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

### Project Path Mapping

Map Linear team keys to local project directories:

```bash
# .env
PROJECT_PATHS=ENG:/Users/you/code/backend,DESIGN:/Users/you/code/frontend
```

When an issue from team "ENG" triggers, Amadeus spawns Claude Code in `/Users/you/code/backend`.

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

### Workflow States

Configure your Linear workflow with these states for best results:

| State | What Happens |
|-------|--------------|
| **Scoping** | Agent spawns, analyzes requirements, creates plan |
| **Ready to Build** | Agent spawns (if not running), begins implementation |
| **Building** | Agent actively coding |
| **Review** | Agent finished, awaiting human review |
| **Feedback Needed** | Agent blocked, needs human input |
| **Done** | Human approved |

## Development

```bash
# Run tests
bun test

# Run tests in watch mode
bun test --watch
```

# Amadeus

Amadeus uses Linear as a control plane to manage multiple Claude Code agents. Each agent runs on a dedicated port, working on different projects. Linear's Kanban board becomes the UI for orchestrating AI-powered development.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LINEAR                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                                     │
│  │ Issue A │  │ Issue B │  │ Issue C │  ...                                │
│  │ ENG-123 │  │ DES-456 │  │ ENG-789 │                                     │
│  └────┬────┘  └────┬────┘  └────┬────┘                                     │
│       │            │            │                                           │
└───────┼────────────┼────────────┼───────────────────────────────────────────┘
        │            │            │
        │ webhooks   │            │ (state changes, comments)
        ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AMADEUS (this server)                               │
│                         localhost:5678                                      │
│                                                                             │
│  • Receives Linear webhooks                                                 │
│  • Spawns/stops agents based on issue state                                 │
│  • Routes messages to correct agent                                         │
│  • Maps Linear teams to project directories                                 │
└─────────────────────────────────────────────────────────────────────────────┘
        │            │            │
        │ spawns     │            │ (one agent per issue)
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  agentapi    │ │  agentapi    │ │  agentapi    │
│  port 8001   │ │  port 8002   │ │  port 8003   │
│              │ │              │ │              │
│ Claude Code  │ │ Claude Code  │ │ Claude Code  │
│ /code/backend│ │ /code/design │ │ /code/backend│
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       │ Linear MCP     │                │ (agents post updates)
       ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LINEAR                                         │
│  Issue A: status → "Building", comment: "Starting implementation..."        │
│  Issue B: status → "Review", comment: "PR ready for review"                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Communication Flow

**Inbound (Linear → Agent):**
1. Issue state changes in Linear (e.g., moved to "Scoping")
2. Linear sends webhook to Amadeus
3. Amadeus spawns an agentapi instance for that issue (if not already running)
4. Amadeus sends issue details to the agent via HTTP

**Outbound (Agent → Linear):**
1. Each project must have Linear MCP configured (see Prerequisites)
2. Claude Code uses the Linear MCP to update issue status, post comments, etc.
3. Updates appear on the Linear issue that triggered the agent

**Key insight:** Amadeus is a one-way orchestrator. It spawns agents and sends them work, but agents communicate back to Linear directly via MCP—not through Amadeus.

## Multi-Project Support

Amadeus supports running agents across multiple projects simultaneously:

| Linear Team | Project Path | Agent Port |
|-------------|--------------|------------|
| ENG | /code/backend | 8001 |
| ENG | /code/backend | 8002 (different issue) |
| DESIGN | /code/frontend | 8003 |

Each issue gets its own agent instance, even if multiple issues target the same project. Agents are isolated and don't interfere with each other.

## Prerequisites

You need these installed on your machine:

1. **Claude Code CLI** - The `claude` command must be available
   ```bash
   # Verify installation
   claude --version
   ```

2. **AgentAPI** - HTTP wrapper for Claude Code ([github.com/coder/agentapi](https://github.com/coder/agentapi))
   ```bash
   # Download binary for macOS
   OS=$(uname -s | tr "[:upper:]" "[:lower:]")
   ARCH=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/")
   curl -fsSL "https://github.com/coder/agentapi/releases/latest/download/agentapi-${OS}-${ARCH}" -o /usr/local/bin/agentapi
   chmod +x /usr/local/bin/agentapi

   # Verify
   agentapi --help
   ```

   **macOS security note:** If you get "cannot be opened because it is from an unidentified developer", go to **System Settings → Privacy & Security** and click "Open Anyway".

3. **Linear MCP Server** - Each project needs Linear MCP configured so Claude can update issues
   ```json
   // .claude/mcp.json (in each project that agents will work in)
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

   Without this, agents can work on code but **cannot post updates back to Linear**.

4. **Tailscale** (optional) - For exposing webhooks to the internet via Funnel

## Quick Start

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your Linear webhook secret and project paths

# Start the server
bun run start

# Expose via Tailscale Funnel (in another terminal)
tailscale funnel --bg 5678
```

## Configuration

Set these environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_WEBHOOK_SECRET` | Yes | Signing secret from Linear webhook settings |
| `PROJECT_PATHS` | No | Team-to-path mappings: `TEAM1:/path1,TEAM2:/path2` |
| `TRIGGER_STATES` | No | States that spawn agents (default: `Scoping,Ready to Build`) |
| `CLAUDE_BOT_USER_ID` | No | Linear user ID to trigger on assignment |
| `PORT` | No | Server port (default: 5678) |

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

# Interactive chat with Claude Code (for testing agentapi integration)
bun run chat
```

## Security Note

Agents run with `--dangerously-skip-permissions` so they can work autonomously without prompting for approval. This means:

- Agents can read/write any files in the project directory
- Agents can run shell commands
- Always review agent output and PRs before merging

Only run Amadeus in environments where you trust the Linear issues being sent to it.

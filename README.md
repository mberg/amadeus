# Amadeus

Amadeus is an AI agent orchestration system that uses Linear and GitHub as a control plane. Fire off issues, let Claude Code agents work them in parallel, and check back when feedback is needed or they are ready for review.

## Why Amadeus?

- **Parallel work, not babysitting** — I noticed I spent too much time staring at Claude Code. I'd get a ton done but usually only on one project since I wasn't able to work in parallel. As Claude Code gets better and better, my time should be focusing on architecting and solutioning, not babysitting Claude Code. I needed an orchestration system that still kept me, the human, very in the loop. I'm not ready yet for a full orchestration solution like Gas Town.

- **Leverage tools we already use** — I wanted a way to leverage tools we already use—Linear and GitHub—to manage the software development process. All decisions and conversations with Claude Code can be incorporated in these for others (including agents) to see.

- **Fire off issues, address papercuts** — I wanted to be able to fire off issues from polished Linear and GitHub interfaces instead of building my own. Being able to create new tasks from my phone whether it's scoping a new idea or addressing papercuts is a huge win.

- **No token costs** — I wanted to leverage my Claude Max account and not pay for extra tokens. The ability to leverage the AgentAPI instead of using Claude's Agent SDK makes this possible.

- **Flexible deployment** — I wanted to be able to run my agents on my local machines (via Tailscale Funnel) for projects that have complex setups or need a lot of CPU, or via [Sprites](https://sprites.dev/) (sandbox VMs).

- **Skills and agent profiles** — I wanted to be able to create different profiles for the Claude Code agents I call, with different skills that can be preconfigured on the fly.

## Architecture

### Standalone

```
┌─────────────────┐     webhook      ┌─────────────────┐
│  Linear/GitHub  │ ───────────────► │     Amadeus     │
└─────────────────┘                  │     Server      │
                                     └────────┬────────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         │                    │                    │
                         ▼                    ▼                    ▼
                  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
                  │ Claude Code │      │ Claude Code │      │ Claude Code │
                  │   Agent 1   │      │   Agent 2   │      │   Agent N   │
                  │ (worktree)  │      │ (worktree)  │      │ (worktree)  │
                  └─────────────┘      └─────────────┘      └─────────────┘
```

### Cloud + Machines

```
┌─────────────────┐     webhook      ┌─────────────────┐
│  Linear/GitHub  │ ───────────────► │   Amadeus Hub   │
└─────────────────┘                  │ (amadeus-cloud) │
                                     └────────┬────────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         │                    │                    │
                         ▼                    ▼                    ▼
                  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
                  │  Machine 1  │      │  Machine 2  │      │   Sprite    │
                  │ (local Mac) │      │ (local Mac) │      │ (sandbox VM)│
                  │  N agents   │      │  N agents   │      │  N agents   │
                  └─────────────┘      └─────────────┘      └─────────────┘
```

### Mode Comparison

|                    | Standalone       | Cloud + Machine    | Sprite             |
|--------------------|------------------|--------------------|--------------------|
| **Postgres**       | No               | Hub only           | No                 |
| **Linear API keys**| Local `.env`     | Hub only           | Hub-forwarded      |
| **Auth**           | Optional token   | Session-based      | API key            |
| **Best for**       | Solo dev         | Team               | Isolated execution |

### Components

- **Amadeus Server** — Receives webhooks from Linear/GitHub, spawns and manages Claude Code agents, serves the monitoring dashboard.

- **Claude Code Agents** — Each agent runs in its own process via the AgentAPI (HTTP interface to Claude Code). Agents work issues autonomously, updating Linear state as they progress.

- **Git Worktrees** — Each agent gets an isolated git worktree, so multiple agents can work on the same repo without conflicts.

- **Dashboard** — Web UI for monitoring agent status, viewing conversations, and sending messages to agents.

## Quick Start (Standalone)

```bash
# Install dependencies
bun install

# Configure secrets
cp .env.example .env
# Edit .env with your Linear API keys and webhook secrets

# Configure realms and projects
cp amadeus.config.example.yaml amadeus.config.yaml
# Edit with your Linear workspaces and project paths

# Start the server
bun run start

# Expose via Tailscale Funnel (in another terminal)
tailscale funnel --bg 5678
```

Then set your Linear webhook URL to `https://your-machine.ts.net/webhook`.

## Cloud + Machine Setup

Use this when you want a central hub (Amadeus Cloud) managing webhooks, auth, and routing, with one or more machines running agents. Machines are lightweight — they don't need Linear API keys or Postgres.

### Prerequisites

Install these on each machine:

```bash
# Bun (JavaScript runtime)
curl -fsSL https://bun.sh/install | bash

# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# AgentAPI (HTTP wrapper for Claude Code)
# macOS ARM:
curl -fsSL -o /usr/local/bin/agentapi \
  https://github.com/coder/agentapi/releases/latest/download/agentapi-darwin-arm64
chmod +x /usr/local/bin/agentapi

# macOS Intel:
curl -fsSL -o /usr/local/bin/agentapi \
  https://github.com/coder/agentapi/releases/latest/download/agentapi-darwin-amd64
chmod +x /usr/local/bin/agentapi

# Linux AMD64:
curl -fsSL -o /usr/local/bin/agentapi \
  https://github.com/coder/agentapi/releases/latest/download/agentapi-linux-amd64
chmod +x /usr/local/bin/agentapi

# GitHub CLI (optional, for PR creation)
# https://cli.github.com
```

### Automated Setup

The setup script checks prerequisites, prompts for configuration, generates `.env` and `amadeus.config.yaml`, and accepts the Claude Code bypass permissions prompt:

```bash
bun scripts/setup-machine.ts
```

Pass `--non-interactive` to read values from environment variables instead:

```bash
AMADEUS_HUB_URL=https://hub.example.com \
AMADEUS_API_KEY=your-key \
bun scripts/setup-machine.ts --non-interactive
```

### Manual Setup

1. Clone and install:
   ```bash
   git clone https://github.com/mberg/amadeus.git
   cd amadeus
   bun install
   ```

2. Create `.env`:
   ```bash
   # API key for hub authentication
   AMADEUS_API_KEY=your-machine-api-key

   # GitHub token for PR creation (optional)
   GH_TOKEN=ghp_xxxxx
   ```

3. Create `amadeus.config.yaml` (or copy from `amadeus.config.machine.yaml`):
   ```yaml
   global:
     runtimeMode: machine
     port: 5678
     agentName: Amadeus
     machine:
       name: "my-machine"
       hubUrl: "https://hub.example.com"
       heartbeat: true
     triggerStates:
       - Planning
     useWorktrees: true
     worktreesDir: ~/.amadeus-worktrees
     profilesDir: ./agent-profiles
     defaultProfile: base
     dbPath: ./amadeus-agents.db
   ```

4. Create worktrees directory:
   ```bash
   mkdir -p ~/.amadeus-worktrees
   ```

5. Accept bypass permissions (required once per machine):
   ```bash
   # Start a temporary agentapi, accept the prompt, then kill it
   agentapi server claude --port 18923 -- --dangerously-skip-permissions
   # When you see "Yes, I accept", press 2 then Enter, then Ctrl+C
   ```

6. Start:
   ```bash
   # Foreground (interactive)
   bun run dev

   # Background with logs
   bun run dev >> /tmp/amadeus.log 2>&1 &

   # Watch logs
   tail -f /tmp/amadeus.log
   ```

### Self-Hosted Hub

To run your own hub instead of using Amadeus Cloud:

1. Set up Postgres:
   ```bash
   createdb amadeus_hub
   ```

2. Create `.env`:
   ```bash
   DATABASE_URL=postgres://localhost/amadeus_hub
   AMADEUS_API_TOKEN=your-secure-token

   # Linear credentials (one per realm)
   LINEAR_API_KEY_MYCOMPANY=lin_api_xxxxx
   LINEAR_WEBHOOK_SECRET_MYCOMPANY=whsec_xxxxx
   ```

3. Create `amadeus.config.yaml`:
   ```yaml
   realms:
     mycompany:
       linearWorkspace: mycompany
       apiKeyEnvVar: LINEAR_API_KEY_MYCOMPANY
       webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_MYCOMPANY
       projects:
         - teamKey: ENG
           path: /tmp/placeholder

   global:
     runtimeMode: hub
     agentName: Amadeus
     port: 5678
     triggerStates:
       - Planning
     security:
       publicDashboard: true
   ```

   The config is seeded into Postgres on first run. To re-seed after changes:
   ```bash
   psql amadeus_hub -c "UPDATE organizations SET config_yaml = NULL WHERE org_id = 'default';"
   ```

4. Start the hub:
   ```bash
   bun src/server.ts
   ```

For the full cloud experience (session auth, onboarding wizard, machine API key management), use [amadeus-cloud](https://github.com/mberg/amadeus-cloud):

```bash
cd ../amadeus-cloud
bun install
bun run src/server.ts
```

### Hub API

All hub API requests need the auth header: `X-Amadeus-Token: <token>`

```bash
# Users
curl -s -H "X-Amadeus-Token: test-token" http://localhost:5678/hub/api/users

# Projects
curl -s -H "X-Amadeus-Token: test-token" http://localhost:5678/hub/api/projects

# Machines (read-only; created via heartbeat registration)
curl -s -H "X-Amadeus-Token: test-token" http://localhost:5678/hub/api/machines

# Link machine to project
curl -s -X POST -H "X-Amadeus-Token: test-token" -H "Content-Type: application/json" \
  -d '{"projectId":"<id>","localRepoPath":"/path/to/repo"}' \
  http://localhost:5678/hub/api/machines/<machine-id>/projects

# Assign user to project on a machine
curl -s -X POST -H "X-Amadeus-Token: test-token" -H "Content-Type: application/json" \
  -d '{"userId":"<id>","machineId":"<id>"}' \
  http://localhost:5678/hub/api/projects/<project-id>/members
```

## Configuration

Amadeus is configured via `amadeus.config.yaml`. Copy `amadeus.config.example.yaml` to get started, or `amadeus.config.machine.yaml` for machine mode.

### Realms

A realm represents a Linear workspace. Each realm has its own API credentials and contains one or more projects. You might have multiple realms if you work across different Linear workspaces.

In machine mode, realms are not needed — the hub handles webhook routing and Linear credentials.

```yaml
realms:
  # Realm name (your choice, used internally)
  mycompany:
    # Linear workspace slug (from linear.app/mycompany)
    linearWorkspace: mycompany

    # Environment variable names for secrets
    apiKeyEnvVar: LINEAR_API_KEY_MYCOMPANY
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_MYCOMPANY

    # Optional: User ID for assignment-based triggering
    # claudeBotUserId: user-id-here

    projects:
      - teamKey: ENG           # Linear team key (from issue IDs like ENG-123)
        linearProject: Backend  # Route by project name within team
        path: /path/to/backend
        githubRepoUrl: https://github.com/mycompany/backend
        profile: base

      - teamKey: ENG
        linearProject: Frontend
        path: /path/to/frontend
        githubRepoUrl: https://github.com/mycompany/frontend
        profile: frontend
        machineUrl: https://my-sprite.sprites.dev  # Forward to remote machine instead of local

  # Second realm for a different workspace
  sidegig:
    linearWorkspace: sidegig
    apiKeyEnvVar: LINEAR_API_KEY_SIDEGIG
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_SIDEGIG
    projects:
      - teamKey: SIDE
        path: /path/to/sidegig
        githubRepoUrl: https://github.com/user/sidegig
```

### Projects

Each project maps a Linear team to a local repository:

- **teamKey** — The Linear team prefix (e.g., `ENG` for issues like `ENG-123`)
- **linearProject** — Route by Linear project name within team (optional)
- **path** — Absolute path to the git repository
- **githubRepoUrl** — GitHub repository URL for PR links
- **profile** — Agent profile to use (optional, falls back to `defaultProfile`)
- **machineUrl** — Forward webhooks to a remote machine instead of running locally (optional)

### Global Settings

```yaml
global:
  # Runtime mode
  runtimeMode: standalone  # standalone | hub | machine

  # Server
  port: 5678
  agentName: Amadeus

  # Trigger states - which Linear states spawn agents
  triggerStates:
    - Planning

  # Git worktrees for isolation
  useWorktrees: true
  worktreesDir: ~/.amadeus-worktrees

  # Agent profiles
  profilesDir: ./agent-profiles
  defaultProfile: base

  # Database
  dbPath: ./amadeus-agents.db

  # Machine identity (for hub/machine modes)
  machine:
    name: "MyMachine"
    hubUrl: "https://hub.example.com"
    heartbeat: true

  # Static machines list (hub mode only)
  machines:
    - name: "sprite-1"
      url: "https://sprite-1.sprites.dev"
```

### Environment Variables

Secrets belong in `.env`, not the config file:

```bash
# Linear credentials (one per realm — standalone/hub only)
LINEAR_API_KEY_MYCOMPANY=lin_api_xxxxx
LINEAR_WEBHOOK_SECRET_MYCOMPANY=whsec_xxxxx

# Machine API key (machine mode — for hub authentication)
AMADEUS_API_KEY=your-machine-api-key

# GitHub token (optional, for PR creation)
GH_TOKEN=ghp_xxxxx
```

## Workflow

### Issue Lifecycle

1. **Create an issue** in Linear or GitHub with enough context for an agent to work it.

2. **Move to trigger state** (e.g., "Planning" in Linear). This fires a webhook to Amadeus.

3. **Agent spawns** — Amadeus creates a git worktree and starts a Claude Code agent with the issue context.

4. **Agent works** — The agent reads the issue, explores the codebase, writes code, runs tests. It updates the Linear state as it progresses:
   - Planning → Building (when starting implementation)
   - Building → Feedback Needed (when agent has questions or needs input)
   - Feedback Needed → Building (after you respond via comments)
   - Building → Review (when done, PR created)

5. **Feedback loop** — When the agent needs clarification, it posts a comment on the issue and moves to "Feedback Needed". Respond via Linear comments, then move back to Building.

6. **Review** — You review the PR, leave comments. Move back to Building if changes needed.

7. **Done** — Merge the PR, close the issue.

### Interacting with Agents

- **Dashboard** — View agent status, read conversation history, send messages
- **Linear/GitHub comments** — Agents can read issue comments for additional context
- **Direct chat** — Use the dashboard to chat with a running agent in real-time

### Typical Patterns

- **Papercuts** — Small bugs or improvements. Create issue, move to Planning, check back later.
- **Features** — Larger work. Break into smaller issues, let agents tackle them in parallel.
- **Blocked agents** — Agent moves to "Feedback Needed" when it needs human input. Respond via dashboard or issue comments.

## Linear Setup

### Webhook Configuration

1. Go to Linear Settings → API → Webhooks
2. Create a webhook pointing to your Amadeus instance:
   - URL: `https://your-machine.ts.net/webhook` (or your public URL)
   - Select events: Issue updates, Comments

### Workflow States

Amadeus uses Linear workflow states to control agent behavior. Recommended states:

| State | Type | Description |
|-------|------|-------------|
| Backlog | backlog | Issues waiting to be worked |
| Planning | unstarted | **Trigger state** — Moving here spawns an agent |
| Building | started | Agent is actively working |
| Feedback Needed | started | Agent is blocked, needs human input |
| Review | started | Agent finished, PR ready for review |
| Done | completed | Work merged and complete |

### Trigger States

Configure which states trigger agent work in `amadeus.config.yaml`:

```yaml
global:
  triggerStates:
    - Planning
```

When an issue moves to a trigger state, Amadeus spawns an agent. The agent automatically transitions to "Building" when it starts working.

### Labels

Use Linear labels to invoke specific skills or profiles:

- **Skill labels** — Labels matching profile names (e.g., `superpowers`, `frontend-design`) automatically merge that profile's configuration when the agent spawns.
- **Profile labels** — Use `profile:name` format to explicitly select a profile (e.g., `profile:frontend`).

## Agent Profiles

Profiles configure Claude Code agents with specific permissions, skills, and prompt additions. They live as JSON files in the `agent-profiles/` directory.

### Profile Structure

```json
{
  "extends": "base",
  "mcpServers": {},
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(bun:*)"
    ]
  },
  "skills": {
    "marketplaces": ["obra/superpowers-marketplace"],
    "install": ["superpowers@superpowers-marketplace"]
  },
  "promptAdditions": [
    "Additional instructions for the agent..."
  ]
}
```

### Fields

- **extends** — Inherit from another profile (e.g., `"extends": "base"`)
- **mcpServers** — MCP server configurations to enable
- **permissions** — Bash command patterns to allow/deny
- **skills** — Skill marketplaces and skills to install
- **promptAdditions** — Additional system prompt instructions

### Configuration

Set the profiles directory and default profile in `amadeus.config.yaml`:

```yaml
global:
  profilesDir: ./agent-profiles
  defaultProfile: base
```

Assign profiles to projects:

```yaml
projects:
  - teamKey: ONA
    path: /path/to/project
    profile: superpowers  # Use superpowers profile for this project
```

## Deployment

### Prerequisites

Install on every machine that will run agents:

| Tool | Required | Install |
|------|----------|---------|
| [Bun](https://bun.sh) | Yes | `curl -fsSL https://bun.sh/install \| bash` |
| [Claude Code](https://claude.com/claude-code) | Yes | `npm install -g @anthropic-ai/claude-code` |
| [AgentAPI](https://github.com/coder/agentapi) | Yes | See install commands above |
| [GitHub CLI](https://cli.github.com) | Optional | `brew install gh` / see website |
| [Tailscale](https://tailscale.com) | Optional | For exposing webhooks via Funnel |

### Standalone

Run Amadeus on your local machine, exposed via Tailscale Funnel:

1. Install and configure Tailscale
2. Enable Funnel for your machine:
   ```bash
   tailscale funnel 5678
   ```
3. Configure `amadeus.config.yaml`:
   ```yaml
   global:
     runtimeMode: standalone
     port: 5678
   ```
4. Start Amadeus:
   ```bash
   bun run src/server.ts
   ```
5. Set your Linear webhook URL to `https://your-machine.ts.net/webhook`

### Cloud + Machine

See [Cloud + Machine Setup](#cloud--machine-setup) above.

### Sprites (Sandbox VMs)

Run agents on isolated [Sprites](https://sprites.dev/) VMs:

1. Install the Sprites CLI:
   ```bash
   curl -fsSL https://sprites.dev/install.sh | bash
   sprite auth setup --token "your-token"
   ```

2. Provision a sprite:
   ```bash
   bun scripts/provision-sprite-api.ts my-sprite https://github.com/user/repo
   ```

3. Configure the sprite's `amadeus.config.yaml`:
   ```yaml
   global:
     runtimeMode: sprite
     port: 8080
     machine:
       name: "my-sprite"
       hubUrl: "https://your-hub.ts.net"
   ```

4. On your hub, register the sprite:
   ```yaml
   global:
     runtimeMode: hub
     machines:
       - name: "my-sprite"
         url: "https://my-sprite.sprites.dev"
   ```

5. Log in to Claude on the sprite:
   ```bash
   sprite console -s my-sprite
   claude login
   ```

## Credits

- **[AgentAPI](https://github.com/coder/agentapi)** by Coder — HTTP wrapper for Claude Code
- **[Claude Code](https://claude.com/claude-code)** by Anthropic — The AI assistant powering agents
- **[Linear](https://linear.app)** — Issue tracker serving as the control plane
- **[Sprites](https://sprites.dev/)** — Sandbox VMs for isolated agent execution

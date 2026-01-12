# ABOUTME: Comprehensive setup guide for Amadeus - Linear-to-Claude Code orchestrator
# ABOUTME: Covers installation, configuration, workflow, and troubleshooting

# Amadeus Setup Guide

This guide walks you through setting up Amadeus from scratch, configuring it for your projects, and understanding the workflow for AI-powered development orchestration.

## Table of Contents

1. [Introduction](#introduction)
2. [How It Works](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Workflow](#workflow)
7. [Running Amadeus](#running-amadeus)
8. [Troubleshooting](#troubleshooting)

---

## Introduction

### What is Amadeus?

Amadeus transforms Linear into a control plane for AI-powered development. Instead of manually running Claude Code on individual tasks, Amadeus automatically spawns and manages Claude Code agents based on your Linear issue board.

**The core idea:** Move a Linear issue to "Planning" → Amadeus spawns a Claude Code agent → Agent analyzes the issue, creates a plan, implements it, and creates a PR → You review and merge.

### Why Use Amadeus?

- **Parallel Development**: Multiple agents work on different issues simultaneously, each in isolated git worktrees
- **Human-in-the-Loop**: Agents pause for approval before implementing, ensuring you control what gets built
- **Linear as UI**: Your existing project management workflow becomes the interface for AI agents
- **Automatic Context**: Agents receive full issue details, project context, and can communicate back via Linear comments

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Agent** | A Claude Code instance working on a specific Linear issue |
| **Worktree** | An isolated git working directory for each agent (prevents conflicts) |
| **Profile** | Configuration for agent capabilities (MCP servers, permissions, skills) |
| **Webhook** | How Linear notifies Amadeus of issue changes |

---

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               LINEAR                                         │
│                                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │   Backend   │    │  Frontend   │    │    API      │                    │
│   │   RECODE-101   │    │   RECODE-102   │    │   RECODE-103   │                    │
│   │  "Planning" │    │ "Building"  │    │  "Review"   │                    │
│   └──────┬──────┘    └──────┬──────┘    └─────────────┘                    │
│          │                  │                                               │
└──────────┼──────────────────┼───────────────────────────────────────────────┘
           │                  │
           │   Webhooks       │   (state changes, new comments)
           ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AMADEUS SERVER                                        │
│                        localhost:5678                                        │
│                                                                             │
│   • Verifies webhook signatures from Linear                                 │
│   • Spawns agents when issues enter trigger states                          │
│   • Routes comments to the correct running agent                            │
│   • Maps Linear projects/teams to local git repositories                    │
│   • Creates isolated worktrees for parallel development                     │
│   • Monitors agent health and handles recovery                              │
│                                                                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
           ┌────────────────────┼────────────────────┐
           │                    │                    │
           ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Claude Code   │  │   Claude Code   │  │   Claude Code   │
│   Agent #1      │  │   Agent #2      │  │   Agent #3      │
│   Port 8001     │  │   Port 8002     │  │   Port 8003     │
│                 │  │                 │  │                 │
│  Worktree:      │  │  Worktree:      │  │  Worktree:      │
│  RECODE-101/       │  │  RECODE-102/       │  │  RECODE-103/       │
│                 │  │                 │  │                 │
│  Branch:        │  │  Branch:        │  │  Branch:        │
│  issue/RECODE-101  │  │  issue/RECODE-102  │  │  issue/RECODE-103  │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         │  linear-cli        │                    │  (agents post updates)
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               LINEAR                                         │
│   Comments: "🤖 Claude: Here's my implementation plan..."                    │
│   Status updates: Planning → Feedback Needed → Building → Review            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Communication Flow

**Linear → Amadeus → Agent (inbound):**
1. User moves issue to "Planning" in Linear
2. Linear sends webhook to Amadeus server
3. Amadeus verifies signature, determines project path
4. Amadeus creates git worktree and spawns Claude Code agent
5. Agent receives issue details and starts working

**Agent → Linear (outbound):**
1. Agent uses `linear-cli` to post comments and update status
2. Comments appear on the original Linear issue
3. Status changes reflect agent progress

**Key insight:** Amadeus is a one-way orchestrator. It spawns agents and forwards messages, but agents communicate back to Linear directly—not through Amadeus.

---

## Prerequisites

Before installing Amadeus, you need these tools on your machine:

### 1. Claude Code CLI

The `claude` command must be available in your terminal.

```bash
# Verify installation
claude --version
```

If not installed, follow the [Claude Code installation guide](https://docs.anthropic.com/claude-code).

### 2. AgentAPI

AgentAPI wraps Claude Code with an HTTP interface, enabling programmatic control.

```bash
# Download for your platform
OS=$(uname -s | tr "[:upper:]" "[:lower:]")
ARCH=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/")
curl -fsSL "https://github.com/coder/agentapi/releases/latest/download/agentapi-${OS}-${ARCH}" \
  -o /usr/local/bin/agentapi
chmod +x /usr/local/bin/agentapi

# Verify installation
agentapi --help
```

**macOS Security Note:** If you see "cannot be opened because it is from an unidentified developer":
1. Go to **System Settings → Privacy & Security**
2. Find the agentapi warning and click **Open Anyway**

### 3. linear-cli

Agents use linear-cli to post comments and update issue status.

```bash
# Option 1: Install via Cargo (requires Rust)
cargo install linear-cli

# Option 2: Download pre-built binary
# https://github.com/Finesssee/linear-cli/releases

# Configure your Linear API key
linear-cli config set-key lin_api_xxxxxxxxxxxxx

# Verify installation
linear-cli --help
```

### 4. Bun Runtime

Amadeus uses Bun instead of Node.js.

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Verify installation
bun --version
```

### 5. Git

Standard git installation. Worktrees require git 2.5+.

```bash
git --version
```

### 6. Tailscale (Recommended)

For exposing webhooks to the internet. See [Running Amadeus](#exposing-via-tailscale-funnel) section.

---

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/amadeus.git
cd amadeus
```

### Step 2: Install Dependencies

```bash
bun install
```

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration (see [Configuration](#configuration) section below).

### Step 4: Verify Setup

```bash
# Run tests to verify everything works
bun test

# Start the server
bun run start
```

You should see:
```
Amadeus server running on port 5678
Dashboard: http://localhost:5678/dashboard
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root. Here's a complete reference:

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `LINEAR_WEBHOOK_SECRET` | Signing secret from Linear webhook settings | `lin_wh_xxxxxxxxxxxx` |

#### Recommended

| Variable | Description | Example |
|----------|-------------|---------|
| `LINEAR_API_KEY` | Your Linear API key (for agents to use linear-cli) | `lin_api_xxxxxxxxxxxx` |
| `PROJECT_PATHS` | Maps Linear projects/teams to local repos | See examples below |
| `LINEAR_WORKSPACE` | Your Linear workspace slug for @mentions | `recode` |

#### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5678` | Server port |
| `TRIGGER_STATES` | `Planning` | States that spawn agents (comma-separated) |
| `USE_WORKTREES` | `true` | Enable git worktrees for isolation |
| `WORKTREES_DIR` | `../.amadeus-worktrees` | Where to create worktrees |
| `PROFILES_DIR` | `./agent-profiles` | Agent profile directory |
| `DEFAULT_PROFILE` | `base` | Default profile when no label matches |
| `TEAM_PROFILES` | - | Per-team defaults: `TEAM1:profile1,TEAM2:profile2` |
| `DB_PATH` | `./amadeus-agents.db` | SQLite database path |
| `HEALTH_CHECK_INTERVAL_MS` | `30000` | Health check frequency |

### Project Path Mapping (PROJECT_PATHS)

This is the most important configuration. It tells Amadeus which local repository to use for each Linear project or team.

#### Format

```
PROJECT_PATHS=Name1:/path/to/repo1,Name2:/path/to/repo2
```

#### Example 1: Single Project

```bash
# All issues from the "Amadeus" project go to /code/amadeus
PROJECT_PATHS=Amadeus:/Users/matt/code/amadeus
```

#### Example 2: Multiple Projects

```bash
# Different Linear projects map to different repositories
PROJECT_PATHS=Backend:/code/backend,Frontend:/code/frontend,Mobile:/code/mobile-app
```

#### Example 3: Project Names with Spaces

```bash
# Quote names containing spaces
PROJECT_PATHS="Data Platform":/code/data-platform,Backend:/code/backend
```

#### Example 4: Team-Based Fallback

```bash
# If no project match, fall back to team key
PROJECT_PATHS=RECODE:/code/recode-default,DESIGN:/code/design-default
```

#### Example 5: Mixed Project + Team Configuration

```bash
# Projects take priority, teams are fallback
PROJECT_PATHS=Amadeus:/code/amadeus,Frontend:/code/frontend,RECODE:/code/recode-fallback
```

#### Example 6: Multi-Team Organization

```bash
# Different teams working on different codebases
PROJECT_PATHS=ENGINEERING:/code/main-app,PLATFORM:/code/platform,MOBILE:/code/mobile,DESIGN:/code/design-system
```

#### Lookup Order

When an issue triggers, Amadeus determines the repository path:

1. **Project name** → Check if issue's project name is in PROJECT_PATHS
2. **Team key** → If no project match, check if team key (e.g., `RECODE`) is in PROJECT_PATHS
3. **DEFAULT** → Falls back to `PROJECT_PATHS=DEFAULT:/some/path` if configured

### Complete .env Example

```bash
# ============================================
# Required
# ============================================
LINEAR_WEBHOOK_SECRET=lin_wh_abc123xyz

# ============================================
# Linear Integration
# ============================================
LINEAR_API_KEY=lin_api_abc123xyz
LINEAR_WORKSPACE=recode

# ============================================
# Project Mappings
# ============================================
# Map Linear projects to local repositories
PROJECT_PATHS=Amadeus:/Users/matt/code/amadeus,Frontend:/Users/matt/code/frontend,"Data Platform":/Users/matt/code/data-platform

# ============================================
# Agent Behavior
# ============================================
# What states trigger agent spawn
TRIGGER_STATES=Planning

# ============================================
# Git Worktrees
# ============================================
USE_WORKTREES=true
WORKTREES_DIR=/Users/matt/.amadeus-worktrees

# ============================================
# Agent Profiles
# ============================================
PROFILES_DIR=./agent-profiles
DEFAULT_PROFILE=base
# Per-team profile defaults
TEAM_PROFILES=DESIGN:frontend,PLATFORM:backend

# ============================================
# Server
# ============================================
PORT=5678
```

### Agent Profiles

Profiles configure agent capabilities. They're JSON files in the `agent-profiles/` directory.

#### Base Profile (agent-profiles/base.json)

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "@larryhudson/linear-mcp-server"],
      "env": {
        "LINEAR_API_KEY": "${LINEAR_API_KEY}"
      }
    }
  },
  "permissions": {
    "allow": [
      "Bash(linear-cli:*)",
      "Bash(git:*)",
      "Bash(bun:*)",
      "Bash(curl:*)"
    ]
  },
  "promptAdditions": []
}
```

#### Frontend Profile (agent-profiles/frontend.json)

```json
{
  "extends": "base",
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-playwright"]
    }
  },
  "permissions": {
    "allow": ["Bash(playwright:*)"]
  },
  "skills": {
    "marketplaces": ["anthropics/skills"],
    "install": ["frontend-design@anthropic-agent-skills"]
  },
  "promptAdditions": [
    "You have access to Playwright for browser automation and testing.",
    "Use the frontend-design skill for creating polished UI components."
  ]
}
```

#### Creating a Custom Profile

Create `agent-profiles/backend.json`:

```json
{
  "extends": "base",
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  },
  "permissions": {
    "allow": ["Bash(psql:*)"]
  },
  "promptAdditions": [
    "You have PostgreSQL access via MCP for database operations."
  ]
}
```

#### Selecting Profiles

Profiles are selected in order:

1. **Issue Labels**: Add `profile:frontend` label to an issue
2. **Team Default**: Set `TEAM_PROFILES=DESIGN:frontend,PLATFORM:backend`
3. **Global Default**: Falls back to `DEFAULT_PROFILE` (default: `base`)

Multiple `profile:` labels merge those profiles together.

---

## Workflow

### The Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AGENT LIFECYCLE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 1. TRIGGER                                                           │  │
│  │    User moves issue to "Planning" in Linear                          │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 2. SPAWN                                                             │  │
│  │    Amadeus receives webhook                                          │  │
│  │    → Creates branch issue/{IDENTIFIER}                               │  │
│  │    → Creates worktree in /.amadeus-worktrees/{IDENTIFIER}            │  │
│  │    → Spawns Claude Code agent on next available port                 │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 3. PLANNING                                                          │  │
│  │    Agent analyzes issue requirements                                 │  │
│  │    Agent explores codebase for context                               │  │
│  │    Agent posts implementation plan as Linear comment                 │  │
│  │    Agent sets status → "Feedback Needed"                             │  │
│  │    Agent STOPS and waits                                             │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 4. APPROVAL LOOP                                                     │  │
│  │    Human reviews plan in Linear                                      │  │
│  │    Human posts comment (approval or requested changes)               │  │
│  │    Amadeus forwards comment to agent                                 │  │
│  │    If changes requested → Agent updates plan, stays in loop          │  │
│  │    If approved → Agent proceeds to building                          │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 5. BUILDING                                                          │  │
│  │    Agent sets status → "Building"                                    │  │
│  │    Agent implements the plan                                         │  │
│  │    Agent commits changes to issue branch                             │  │
│  │    Agent posts progress updates as comments                          │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 6. COMPLETION                                                        │  │
│  │    Agent pushes branch to origin                                     │  │
│  │    Agent creates PR using gh pr create                               │  │
│  │    Agent posts PR URL as Linear comment                              │  │
│  │    Agent sets status → "Review"                                      │  │
│  │    Agent stops                                                       │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 7. REVIEW & MERGE                                                    │  │
│  │    Human reviews PR on GitHub                                        │  │
│  │    Human merges PR                                                   │  │
│  │    Amadeus detects merge → sets status → "Done"                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Status Flow

```
┌───────────┐    ┌──────────────────┐    ┌───────────┐    ┌──────────┐    ┌──────┐
│ Planning  │───▶│ Feedback Needed  │───▶│ Building  │───▶│  Review  │───▶│ Done │
└───────────┘    └──────────────────┘    └───────────┘    └──────────┘    └──────┘
      │                   │ ▲                  │
      │                   │ │                  │
      │                   ▼ │                  │
      │            ┌─────────────┐             │
      │            │  Revisions  │             │
      │            │  (human     │             │
      │            │  requests   │             │
      │            │  changes)   │             │
      │            └─────────────┘             │
      │                                        │
      └────────────────────────────────────────┘
           (if agent crashes, restarts here)
```

### Status Reference

| Status | Set By | Meaning |
|--------|--------|---------|
| **Planning** | Human | Triggers agent spawn |
| **Feedback Needed** | Agent | Plan posted, waiting for human approval |
| **Building** | Agent | Human approved, agent implementing |
| **Review** | Agent | PR created, awaiting human review |
| **Done** | Amadeus | PR merged (auto-detected) |

### How Comments Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMMENT FLOW                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  HUMAN POSTS COMMENT IN LINEAR                                              │
│  "Looks good, please proceed"                                               │
│          │                                                                  │
│          ▼                                                                  │
│  LINEAR WEBHOOK ─────────────────▶ AMADEUS SERVER                           │
│          │                              │                                   │
│          │                              │ Look up running agent             │
│          │                              │ for this issue                    │
│          │                              ▼                                   │
│          │                        Forward comment                           │
│          │                        to agent via HTTP                         │
│          │                              │                                   │
│          │                              ▼                                   │
│          │                        CLAUDE CODE AGENT                         │
│          │                        receives message,                         │
│          │                        continues work                            │
│          │                              │                                   │
│          │                              ▼                                   │
│  AGENT POSTS RESPONSE          linear-cli comments create                   │
│  "🤖 Claude: Starting         --body "🤖 Claude: ..."                       │
│   implementation..."                    │                                   │
│          ▲                              │                                   │
│          │                              │                                   │
│          └──────────────────────────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Git Worktrees

Each agent works in an isolated directory to prevent conflicts:

```
/code/backend/                          ← Main repository (stays clean)
    ├── .git/
    ├── src/
    └── ...

/.amadeus-worktrees/
    ├── RECODE-101/                        ← Agent 1's workspace
    │   ├── .git (linked)               ← Points to main .git
    │   ├── src/                        ← Full checkout
    │   └── ...                         ← On branch issue/RECODE-101
    │
    ├── RECODE-102/                        ← Agent 2's workspace
    │   └── ...                         ← On branch issue/RECODE-102
    │
    └── RECODE-103/                        ← Agent 3's workspace
        └── ...                         ← On branch issue/RECODE-103
```

**Benefits:**
- Multiple agents on same project without file conflicts
- Each agent's changes are isolated to its branch
- Main repository stays clean
- Branches preserved after agent stops (for PR review)

---

## Running Amadeus

### Starting the Server

```bash
# Start in foreground
bun run start

# Or run directly
bun src/server.ts
```

### Exposing via Tailscale Funnel

Linear needs to send webhooks to your server. Tailscale Funnel exposes your local server to the internet securely.

#### Step 1: Install Tailscale

Download from [tailscale.com/download](https://tailscale.com/download) and authenticate:

```bash
tailscale login
tailscale status  # Verify connected
```

#### Step 2: Enable Funnel

In your Tailscale admin console ([login.tailscale.com/admin/acls](https://login.tailscale.com/admin/acls)), add:

```json
{
  "nodeAttrs": [
    {
      "target": ["*"],
      "attr": ["funnel"]
    }
  ]
}
```

#### Step 3: Start Funnel

```bash
# Start Amadeus
bun run start

# In another terminal, expose port 5678
tailscale funnel --bg 5678

# Find your public URL
tailscale funnel status
```

Your URL will be: `https://<machine-name>.<tailnet>.ts.net`

### Configuring Linear Webhook

1. Go to **Linear → Settings → API → Webhooks**
2. Click **New Webhook**
3. Set URL to: `https://<your-machine>.ts.net/webhook`
4. Select events: **Issues**, **Comments**
5. Copy the **Signing Secret** to your `.env` as `LINEAR_WEBHOOK_SECRET`

### Verifying Setup

1. **Check server health:**
   ```bash
   curl http://localhost:5678/health
   ```

2. **View dashboard:**
   Open `http://localhost:5678/dashboard` in your browser

3. **Test webhook:**
   Move a Linear issue to "Planning" and watch the server logs

### Dashboard

The web dashboard at `/dashboard` shows:
- All running agents with their status
- Links to Linear issues
- Repository paths
- Agent uptime

---

## Troubleshooting

### Common Issues

#### Webhook Not Received

**Symptoms:** Moving issues to "Planning" does nothing

**Check:**
1. Tailscale Funnel is running: `tailscale funnel status`
2. Webhook URL in Linear matches your Funnel URL exactly
3. `LINEAR_WEBHOOK_SECRET` matches the secret in Linear
4. Server is running: `curl http://localhost:5678/health`

#### Agent Doesn't Start

**Symptoms:** Webhook received but no agent spawns

**Check:**
1. Issue state is in `TRIGGER_STATES` (default: "Planning")
2. Issue is not a draft
3. Project/team is mapped in `PROJECT_PATHS`
4. Repository path exists and is a git repo
5. Check server logs for errors

#### Agent Can't Post to Linear

**Symptoms:** Agent runs but no comments appear in Linear

**Check:**
1. `linear-cli` is installed and in PATH
2. Linear API key is configured: `linear-cli config get-key`
3. Agent profile includes Linear MCP server
4. `LINEAR_API_KEY` environment variable is set

#### Git Worktree Errors

**Symptoms:** "fatal: branch already exists" or worktree creation fails

**Check:**
1. Clean up stale worktrees:
   ```bash
   git worktree list
   git worktree prune
   ```
2. Ensure branch isn't checked out elsewhere:
   ```bash
   git branch -a | grep issue/RECODE-XXX
   ```

#### AgentAPI Not Found

**Symptoms:** "agentapi: command not found"

**Fix:**
```bash
# Reinstall agentapi
OS=$(uname -s | tr "[:upper:]" "[:lower:]")
ARCH=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/")
curl -fsSL "https://github.com/coder/agentapi/releases/latest/download/agentapi-${OS}-${ARCH}" \
  -o /usr/local/bin/agentapi
chmod +x /usr/local/bin/agentapi
```

### Useful Commands

```bash
# Check server health
curl http://localhost:5678/health

# View running agents (JSON)
curl http://localhost:5678/status

# Check Tailscale status
tailscale status
tailscale funnel status

# View worktrees
git worktree list

# Clean up stale worktrees
git worktree prune

# Test linear-cli
linear-cli issues list --limit 5
```

### Log Locations

- **Server logs:** stdout (where you ran `bun run start`)
- **Agent database:** `./amadeus-agents.db` (SQLite)
- **Health check interval:** Configured via `HEALTH_CHECK_INTERVAL_MS`

### Getting Help

If you're stuck:
1. Check server logs for error messages
2. Verify all prerequisites are installed
3. Confirm environment variables are set correctly
4. Check the dashboard at `/dashboard` for agent status

---

## Next Steps

Once Amadeus is running:

1. **Test with a simple issue:** Create a Linear issue, add clear requirements, move to "Planning"
2. **Review the agent's plan:** Comment with approval or request changes
3. **Watch the implementation:** Agent will post progress updates
4. **Review the PR:** Agent creates a PR when done
5. **Iterate:** Adjust profiles and configuration based on your workflow

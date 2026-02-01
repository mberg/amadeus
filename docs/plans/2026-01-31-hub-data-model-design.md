# Hub Data Model Redesign

## Overview

Replace the YAML-driven config/realm system with a relational data model managed through the hub. Machines become minimal (name + token + hubUrl). All routing, permissions, and project configuration lives in the hub database.

## Core Entities

### Users

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | primary key |
| org_id | UUID, nullable | null for solo users |
| name | TEXT | |
| email | TEXT | |
| linear_user_id | TEXT | auto-fetched when PAT is set |
| linear_pat_encrypted | TEXT | encrypted Linear personal access token |
| auth_method | TEXT | "clerk" (cloud) or "api_key" (self-hosted) |
| api_key_hash | TEXT, nullable | for self-hosted auth |
| created_at | TIMESTAMPTZ | |

When a user adds their Linear PAT, the hub fetches their Linear user ID automatically and stores it. This links the Amadeus user to their Linear identity for routing.

### Organizations (extend existing table)

| Field | Type | Notes |
|-------|------|-------|
| id | TEXT | primary key (existing) |
| name | TEXT | new |
| owner_user_id | UUID | new, references users |
| config_yaml | TEXT | deprecated, migrate to relational tables |
| created_at | TIMESTAMPTZ | existing |
| updated_at | TIMESTAMPTZ | existing |

A solo user doesn't need an org. Multiple users collaborating requires an org.

### Org Members (new)

| Field | Type | Notes |
|-------|------|-------|
| org_id | TEXT | references organizations |
| user_id | UUID | references users |
| role | TEXT | "owner" or "member" |

### Machines (modify existing table)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | primary key (existing) |
| org_id | TEXT | references organizations |
| name | TEXT | friendly name |
| owner_user_id | UUID | references users |
| url | TEXT | where hub routes commands/webhooks |
| token_hash | TEXT | SHA256 hash, machine authenticates with this |
| permission | TEXT | "public" or "allowed" |
| status | TEXT | "unknown", "healthy", "unhealthy", "dormant" |
| last_seen | TIMESTAMPTZ | updated on heartbeat |
| created_at | TIMESTAMPTZ | |

### Machine Access (new, for "allowed" permission mode)

| Field | Type | Notes |
|-------|------|-------|
| machine_id | UUID | references machines |
| user_id | UUID | references users |

### Projects (new)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | primary key |
| org_id | TEXT | references organizations |
| name | TEXT | project name (can be auto-fetched from Linear/GitHub) |
| linear_project_url | TEXT, nullable | link to Linear project |
| github_repo_url | TEXT, nullable | link to GitHub repo |
| linear_team_key | TEXT, nullable | extracted or manually set, used for routing |
| linear_project_name | TEXT, nullable | extracted or manually set, used for routing |
| created_at | TIMESTAMPTZ | |

### Machine Projects (new, maps projects to machines with local paths)

| Field | Type | Notes |
|-------|------|-------|
| machine_id | UUID | references machines |
| project_id | UUID | references projects |
| local_repo_path | TEXT | filesystem path on the machine |

### Project Members (new, maps users to projects on specific machines)

| Field | Type | Notes |
|-------|------|-------|
| project_id | UUID | references projects |
| user_id | UUID | references users |
| machine_id | UUID | references machines |

## Webhook Routing Flow

1. Linear webhook arrives at hub
2. Hub extracts `teamKey` and/or `linearProjectName` from payload
3. Hub queries **projects** table to find matching project
4. Hub extracts assignee Linear user ID from payload
5. Hub maps assignee to Amadeus user via `linear_user_id`
6. Hub queries **project_members** to find which machine that user uses for this project
7. Hub forwards webhook to the machine's `url`, including the `local_repo_path` in the payload
8. Machine uses the provided repo path to know where to work

If no specific user mapping exists (unassigned issue, or user not in system), hub can fall back to round-robin or least-loaded machine that has the project mapped.

## Machine Registration Flow

1. Admin creates machine in hub UI — sets name, owner, url, permission mode
2. Hub generates a token for the machine
3. Machine is configured locally with minimal config:
   ```yaml
   machine:
     name: "claudius"
     token: "abc123..."
     hubUrl: "https://hub.example.com"
   ```
4. Machine starts, sends heartbeat to hub with name + token
5. Hub validates token, updates status and last_seen
6. Hub can send back project list with local repo paths so machine knows its assignments

## Permissions

- **Public machine**: any user in the org can route work to it
- **Allowed machine**: only users in the machine_access list can route work to it
- **Solo user (no org)**: one user, their machines, their projects, no permissions needed
- **Org**: owner manages machines, users, permissions. Each user adds their own Linear PAT.

## What Gets Removed

- **Realms**: Linear workspace concept absorbed into org level
- **YAML project routing**: replaced by relational project/machine_projects tables
- **Static machines list in YAML config**: all machine management through hub DB
- **config_yaml blob in organizations**: replaced by relational tables

## Existing Tables Kept

- **completed_tasks**: as-is
- **secrets**: repurposed for user PATs (already supports encrypted storage per org)

## User Secrets

Each user stores their Linear PAT (encrypted). When the PAT is added, the hub:
1. Calls Linear API to fetch the user's Linear user ID
2. Stores `linear_user_id` on the user record
3. Encrypts and stores the PAT

This enables automatic routing based on Linear issue assignment.

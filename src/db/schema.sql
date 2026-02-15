-- ABOUTME: Postgres schema for Amadeus hub.
-- ABOUTME: All tables scoped by org_id for multi-tenant support.

CREATE TABLE IF NOT EXISTS organizations (
  org_id      TEXT PRIMARY KEY,
  config_yaml TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS machines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       TEXT NOT NULL REFERENCES organizations(org_id),
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_seen    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS secrets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL REFERENCES organizations(org_id),
  key_name      TEXT NOT NULL,
  encrypted_val TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, key_name)
);

CREATE TABLE IF NOT EXISTS completed_tasks (
  id                 SERIAL PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(org_id),
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

-- Users within an organization
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT REFERENCES organizations(org_id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  linear_user_id  TEXT,
  auth_method     TEXT NOT NULL DEFAULT 'api_key',
  api_key_hash    TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Extend organizations with name and owner
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_user_id UUID;

-- Extend machines with ownership, permission, and status
ALTER TABLE machines ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);
ALTER TABLE machines ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'public';
ALTER TABLE machines ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown';

-- Maps users to organizations with a role
CREATE TABLE IF NOT EXISTS org_members (
  org_id   TEXT NOT NULL REFERENCES organizations(org_id),
  user_id  UUID NOT NULL REFERENCES users(id),
  role     TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (org_id, user_id)
);

-- Per-user access grants for private machines
CREATE TABLE IF NOT EXISTS machine_access (
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (machine_id, user_id)
);

-- Realms group a Linear workspace with its credentials and projects
CREATE TABLE IF NOT EXISTS realms (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             TEXT NOT NULL REFERENCES organizations(org_id),
  name               TEXT NOT NULL,
  linear_workspace   TEXT NOT NULL,
  claude_bot_user_id TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

-- Projects track a Linear project + GitHub repo pair
CREATE TABLE IF NOT EXISTS projects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               TEXT NOT NULL REFERENCES organizations(org_id),
  name                 TEXT NOT NULL,
  linear_project_url   TEXT,
  github_repo_url      TEXT,
  linear_team_key      TEXT,
  linear_project_name  TEXT,
  realm_id             UUID REFERENCES realms(id),
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- Links machines to projects with a local checkout path
CREATE TABLE IF NOT EXISTS machine_projects (
  machine_id      UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  local_repo_path TEXT NOT NULL,
  PRIMARY KEY (machine_id, project_id)
);

-- Assigns users to projects, scoped to a specific machine
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

-- Indexes

CREATE INDEX IF NOT EXISTS idx_completed_tasks_org_date
  ON completed_tasks (org_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_machines_org
  ON machines (org_id);

CREATE INDEX IF NOT EXISTS idx_secrets_org_key
  ON secrets (org_id, key_name);

CREATE INDEX IF NOT EXISTS idx_users_org
  ON users (org_id);

CREATE INDEX IF NOT EXISTS idx_users_linear_id
  ON users (linear_user_id);

-- Add realm_id to existing projects tables
ALTER TABLE projects ADD COLUMN IF NOT EXISTS realm_id UUID REFERENCES realms(id);

-- Maps users to realms with a role
CREATE TABLE IF NOT EXISTS realm_members (
  realm_id UUID NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (realm_id, user_id)
);

-- Per-realm Linear identity for users (different Linear accounts per workspace)
ALTER TABLE realm_members ADD COLUMN IF NOT EXISTS linear_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_realm_members_linear_id
  ON realm_members (linear_user_id);

CREATE INDEX IF NOT EXISTS idx_realms_org
  ON realms (org_id);

CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects (org_id);

CREATE INDEX IF NOT EXISTS idx_projects_linear
  ON projects (org_id, linear_team_key);

CREATE INDEX IF NOT EXISTS idx_projects_realm
  ON projects (realm_id);

-- Add editable prompt template per realm
ALTER TABLE realms ADD COLUMN IF NOT EXISTS prompt_template TEXT;

-- Ensure a default org exists for open-source single-tenant mode
INSERT INTO organizations (org_id) VALUES ('default')
  ON CONFLICT (org_id) DO NOTHING;

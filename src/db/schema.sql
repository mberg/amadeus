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

CREATE INDEX IF NOT EXISTS idx_completed_tasks_org_date
  ON completed_tasks (org_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_machines_org
  ON machines (org_id);

CREATE INDEX IF NOT EXISTS idx_secrets_org_key
  ON secrets (org_id, key_name);

-- Ensure a default org exists for open-source single-tenant mode
INSERT INTO organizations (org_id) VALUES ('default')
  ON CONFLICT (org_id) DO NOTHING;

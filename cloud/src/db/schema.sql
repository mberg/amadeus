-- ABOUTME: Cloud-only Postgres schema for amadeus-cloud.
-- ABOUTME: Extends the amadeus base schema with onboarding state tracking.

CREATE TABLE IF NOT EXISTS onboarding_state (
  org_id             TEXT PRIMARY KEY REFERENCES organizations(org_id),
  current_step       TEXT NOT NULL DEFAULT 'connect_linear',
  linear_connected   BOOLEAN DEFAULT false,
  machine_registered BOOLEAN DEFAULT false,
  webhook_verified   BOOLEAN DEFAULT false,
  completed_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ DEFAULT now()
);

// ABOUTME: Cloud-only Postgres data access for onboarding state.
// ABOUTME: Manages the onboarding_state table for guided setup flow.

import { sql } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OnboardingState {
  orgId: string;
  currentStep: string;
  linearConnected: boolean;
  machineRegistered: boolean;
  webhookVerified: boolean;
  completedAt: Date | null;
}

export async function migrateCloud(): Promise<void> {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  await sql.unsafe(schema);
}

export async function getOnboardingState(orgId: string): Promise<OnboardingState | null> {
  const [row] = await sql`
    SELECT org_id, current_step, linear_connected, machine_registered,
           webhook_verified, completed_at
    FROM onboarding_state
    WHERE org_id = ${orgId}
  `;
  if (!row) return null;

  return {
    orgId: row.org_id as string,
    currentStep: row.current_step as string,
    linearConnected: row.linear_connected as boolean,
    machineRegistered: row.machine_registered as boolean,
    webhookVerified: row.webhook_verified as boolean,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
  };
}

export async function setOnboardingStep(orgId: string, step: string): Promise<void> {
  await sql`
    INSERT INTO onboarding_state (org_id, current_step)
    VALUES (${orgId}, ${step})
    ON CONFLICT (org_id)
    DO UPDATE SET current_step = ${step}, updated_at = now()
  `;
}

export async function setOnboardingFlag(
  orgId: string,
  flag: "linear_connected" | "machine_registered" | "webhook_verified",
  value: boolean
): Promise<void> {
  // Ensure row exists first
  await sql`
    INSERT INTO onboarding_state (org_id)
    VALUES (${orgId})
    ON CONFLICT (org_id) DO NOTHING
  `;

  await sql.unsafe(
    `UPDATE onboarding_state SET ${flag} = $1, updated_at = now() WHERE org_id = $2`,
    [value, orgId]
  );
}

export async function completeOnboarding(orgId: string): Promise<void> {
  await sql`
    UPDATE onboarding_state
    SET completed_at = now(), updated_at = now()
    WHERE org_id = ${orgId}
  `;
}

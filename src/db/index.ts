// ABOUTME: Postgres data access layer for Amadeus.
// ABOUTME: All queries scoped by org_id for multi-tenant support.

import { sql, SQL } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompletedTask, CompletionReason } from "../types";

const DEFAULT_ORG_ID = "default";

/**
 * Run schema migration on startup.
 */
export async function migrate(): Promise<void> {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  await sql.unsafe(schema);
}

/**
 * Ensure an org exists, creating it if needed.
 */
export async function ensureOrg(orgId: string): Promise<void> {
  await sql`
    INSERT INTO organizations (org_id)
    VALUES (${orgId})
    ON CONFLICT (org_id) DO NOTHING
  `;
}

// --- Config ---

export async function getConfigYaml(orgId: string = DEFAULT_ORG_ID): Promise<string | null> {
  const [row] = await sql`
    SELECT config_yaml FROM organizations WHERE org_id = ${orgId}
  `;
  return row?.config_yaml ?? null;
}

export async function saveConfigYaml(orgId: string, yaml: string): Promise<void> {
  await sql`
    UPDATE organizations
    SET config_yaml = ${yaml}, updated_at = now()
    WHERE org_id = ${orgId}
  `;
}

// --- Machines ---

export interface DbMachine {
  id: string;
  orgId: string;
  name: string;
  url: string;
  apiKeyHash: string;
  createdAt: Date;
  lastSeen: Date | null;
}

export async function getMachines(orgId: string): Promise<DbMachine[]> {
  const rows = await sql`
    SELECT id, org_id, name, url, api_key_hash, created_at, last_seen
    FROM machines WHERE org_id = ${orgId}
  `;
  return rows.map(rowToMachine);
}

export async function createMachine(
  orgId: string,
  name: string,
  url: string,
  apiKeyHash: string
): Promise<DbMachine> {
  const [row] = await sql`
    INSERT INTO machines (org_id, name, url, api_key_hash)
    VALUES (${orgId}, ${name}, ${url}, ${apiKeyHash})
    RETURNING id, org_id, name, url, api_key_hash, created_at, last_seen
  `;
  return rowToMachine(row);
}

export async function deleteMachine(id: string, orgId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM machines WHERE id = ${id} AND org_id = ${orgId}
  `;
  return result.count > 0;
}

export async function updateMachineLastSeen(id: string): Promise<void> {
  await sql`
    UPDATE machines SET last_seen = now() WHERE id = ${id}
  `;
}

export async function authenticateMachine(
  apiKeyHash: string
): Promise<{ orgId: string; machineName: string; machineId: string } | null> {
  const [row] = await sql`
    SELECT id, org_id, name FROM machines WHERE api_key_hash = ${apiKeyHash}
  `;
  if (!row) return null;
  return { orgId: row.org_id, machineName: row.name, machineId: row.id };
}

function rowToMachine(row: Record<string, unknown>): DbMachine {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    url: row.url as string,
    apiKeyHash: row.api_key_hash as string,
    createdAt: new Date(row.created_at as string),
    lastSeen: row.last_seen ? new Date(row.last_seen as string) : null,
  };
}

// --- Secrets ---

export async function getSecret(orgId: string, keyName: string): Promise<string | null> {
  const [row] = await sql`
    SELECT encrypted_val FROM secrets
    WHERE org_id = ${orgId} AND key_name = ${keyName}
  `;
  return row?.encrypted_val ?? null;
}

export async function setSecret(orgId: string, keyName: string, encryptedVal: string): Promise<void> {
  await sql`
    INSERT INTO secrets (org_id, key_name, encrypted_val)
    VALUES (${orgId}, ${keyName}, ${encryptedVal})
    ON CONFLICT (org_id, key_name)
    DO UPDATE SET encrypted_val = ${encryptedVal}, updated_at = now()
  `;
}

export async function deleteSecret(orgId: string, keyName: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM secrets WHERE org_id = ${orgId} AND key_name = ${keyName}
  `;
  return result.count > 0;
}

// --- Completed Tasks ---

export async function recordCompletedTask(orgId: string, task: CompletedTask): Promise<void> {
  await sql`
    INSERT INTO completed_tasks (
      org_id, key, issue_id, issue_identifier, issue_title,
      linear_project, completed_at, completion_reason, final_linear_state, duration_ms
    ) VALUES (
      ${orgId}, ${task.key}, ${task.issueId}, ${task.issueIdentifier}, ${task.issueTitle},
      ${task.linearProject ?? null}, ${task.completedAt.toISOString()}, ${task.completionReason},
      ${task.finalLinearState ?? null}, ${task.duration}
    )
  `;
}

export async function getCompletedTasks(
  orgId: string,
  limit: number = 20,
  offset: number = 0
): Promise<CompletedTask[]> {
  const rows = await sql`
    SELECT key, issue_id, issue_identifier, issue_title, linear_project,
           completed_at, completion_reason, final_linear_state, duration_ms
    FROM completed_tasks
    WHERE org_id = ${orgId}
    ORDER BY completed_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map(rowToCompletedTask);
}

export async function getCompletedTaskCount(orgId: string): Promise<number> {
  const [row] = await sql`
    SELECT COUNT(*)::int as count FROM completed_tasks WHERE org_id = ${orgId}
  `;
  return row?.count ?? 0;
}

function rowToCompletedTask(row: Record<string, unknown>): CompletedTask {
  return {
    key: row.key as string,
    issueId: row.issue_id as string,
    issueIdentifier: row.issue_identifier as string,
    issueTitle: row.issue_title as string,
    linearProject: row.linear_project as string | undefined,
    completedAt: new Date(row.completed_at as string),
    completionReason: row.completion_reason as CompletionReason,
    finalLinearState: row.final_linear_state as string | undefined,
    duration: row.duration_ms as number,
  };
}

// --- Connection management ---

export async function close(): Promise<void> {
  await sql.close();
}

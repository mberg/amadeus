// ABOUTME: Extended machine operations for owner, permission, and status columns.
// ABOUTME: Supplements the base machine CRUD in db/index.ts.

import { sql } from "bun";

export interface DbMachineExtended {
  id: string;
  orgId: string;
  name: string;
  url: string;
  apiKeyHash: string;
  ownerUserId: string | null;
  permission: string;
  status: string;
  createdAt: Date;
  lastSeen: Date | null;
}

export async function getMachineWithPermission(
  id: string
): Promise<DbMachineExtended | null> {
  const [row] = await sql`
    SELECT * FROM machines WHERE id = ${id}
  `;
  return row ? rowToMachineExtended(row) : null;
}

export async function updateMachineOwner(
  id: string,
  ownerUserId: string
): Promise<DbMachineExtended | null> {
  const [row] = await sql`
    UPDATE machines SET owner_user_id = ${ownerUserId}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToMachineExtended(row) : null;
}

export async function updateMachinePermission(
  id: string,
  permission: string
): Promise<DbMachineExtended | null> {
  const [row] = await sql`
    UPDATE machines SET permission = ${permission}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToMachineExtended(row) : null;
}

export async function updateMachineApiKeyHash(
  id: string,
  apiKeyHash: string
): Promise<DbMachineExtended | null> {
  const [row] = await sql`
    UPDATE machines SET api_key_hash = ${apiKeyHash}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToMachineExtended(row) : null;
}

export async function updateMachineStatus(
  id: string,
  status: string
): Promise<DbMachineExtended | null> {
  const [row] = await sql`
    UPDATE machines SET status = ${status}, last_seen = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToMachineExtended(row) : null;
}

function rowToMachineExtended(row: Record<string, unknown>): DbMachineExtended {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    url: row.url as string,
    apiKeyHash: row.api_key_hash as string,
    ownerUserId: (row.owner_user_id as string) ?? null,
    permission: row.permission as string,
    status: row.status as string,
    createdAt: new Date(row.created_at as string),
    lastSeen: row.last_seen ? new Date(row.last_seen as string) : null,
  };
}

// ABOUTME: CRUD operations for the realms table in Postgres.
// ABOUTME: Realms group a Linear workspace with its credentials, scoped by org_id.

import { sql } from "bun";

export interface DbRealm {
  id: string;
  orgId: string;
  name: string;
  linearWorkspace: string;
  claudeBotUserId: string | null;
  createdAt: Date;
}

export interface CreateRealmParams {
  orgId: string;
  name: string;
  linearWorkspace: string;
  claudeBotUserId?: string;
}

interface UpdateRealmParams {
  name?: string;
  linearWorkspace?: string;
  claudeBotUserId?: string | null;
}

export async function createRealm(params: CreateRealmParams): Promise<DbRealm> {
  const [row] = await sql`
    INSERT INTO realms (org_id, name, linear_workspace, claude_bot_user_id)
    VALUES (
      ${params.orgId},
      ${params.name},
      ${params.linearWorkspace},
      ${params.claudeBotUserId ?? null}
    )
    RETURNING id, org_id, name, linear_workspace, claude_bot_user_id, created_at
  `;
  return rowToRealm(row);
}

export async function getRealm(id: string): Promise<DbRealm | null> {
  const [row] = await sql`
    SELECT id, org_id, name, linear_workspace, claude_bot_user_id, created_at
    FROM realms WHERE id = ${id}
  `;
  return row ? rowToRealm(row) : null;
}

export async function getRealmByName(orgId: string, name: string): Promise<DbRealm | null> {
  const [row] = await sql`
    SELECT id, org_id, name, linear_workspace, claude_bot_user_id, created_at
    FROM realms WHERE org_id = ${orgId} AND name = ${name}
  `;
  return row ? rowToRealm(row) : null;
}

export async function getRealmsByOrg(orgId: string): Promise<DbRealm[]> {
  const rows = await sql`
    SELECT id, org_id, name, linear_workspace, claude_bot_user_id, created_at
    FROM realms WHERE org_id = ${orgId}
    ORDER BY created_at
  `;
  return rows.map(rowToRealm);
}

export async function updateRealm(id: string, params: UpdateRealmParams): Promise<DbRealm | null> {
  const current = await getRealm(id);
  if (!current) return null;

  const newName = params.name ?? current.name;
  const newWorkspace = params.linearWorkspace ?? current.linearWorkspace;
  const newBotUserId = params.claudeBotUserId !== undefined ? params.claudeBotUserId : current.claudeBotUserId;

  const [row] = await sql`
    UPDATE realms
    SET name = ${newName},
        linear_workspace = ${newWorkspace},
        claude_bot_user_id = ${newBotUserId}
    WHERE id = ${id}
    RETURNING id, org_id, name, linear_workspace, claude_bot_user_id, created_at
  `;
  return row ? rowToRealm(row) : null;
}

export async function deleteRealm(id: string, orgId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM realms WHERE id = ${id} AND org_id = ${orgId}
  `;
  return result.count > 0;
}

function rowToRealm(row: Record<string, unknown>): DbRealm {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    linearWorkspace: row.linear_workspace as string,
    claudeBotUserId: (row.claude_bot_user_id as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

// ABOUTME: CRUD operations for the users table in Postgres.
// ABOUTME: All queries use Bun.sql tagged template literals.

import { sql } from "bun";

export interface DbUser {
  id: string;
  orgId: string;
  name: string;
  email: string;
  linearUserId: string | null;
  authMethod: string;
  apiKeyHash: string | null;
  createdAt: Date;
}

interface CreateUserParams {
  orgId: string;
  name: string;
  email: string;
  authMethod: string;
  apiKeyHash?: string;
  linearUserId?: string;
}

export async function createUser(params: CreateUserParams): Promise<DbUser> {
  const [row] = await sql`
    INSERT INTO users (org_id, name, email, auth_method, api_key_hash, linear_user_id)
    VALUES (
      ${params.orgId},
      ${params.name},
      ${params.email},
      ${params.authMethod},
      ${params.apiKeyHash ?? null},
      ${params.linearUserId ?? null}
    )
    RETURNING id, org_id, name, email, linear_user_id, auth_method, api_key_hash, created_at
  `;
  return rowToUser(row);
}

export async function getUser(id: string): Promise<DbUser | null> {
  const [row] = await sql`
    SELECT id, org_id, name, email, linear_user_id, auth_method, api_key_hash, created_at
    FROM users WHERE id = ${id}
  `;
  return row ? rowToUser(row) : null;
}

export async function getUserByLinearId(
  orgId: string,
  linearUserId: string
): Promise<DbUser | null> {
  const [row] = await sql`
    SELECT id, org_id, name, email, linear_user_id, auth_method, api_key_hash, created_at
    FROM users WHERE org_id = ${orgId} AND linear_user_id = ${linearUserId}
  `;
  return row ? rowToUser(row) : null;
}

export async function getUsersByOrg(orgId: string): Promise<DbUser[]> {
  const rows = await sql`
    SELECT id, org_id, name, email, linear_user_id, auth_method, api_key_hash, created_at
    FROM users WHERE org_id = ${orgId}
  `;
  return rows.map(rowToUser);
}

export async function updateUserLinearId(
  id: string,
  linearUserId: string
): Promise<DbUser | null> {
  const [row] = await sql`
    UPDATE users SET linear_user_id = ${linearUserId}
    WHERE id = ${id}
    RETURNING id, org_id, name, email, linear_user_id, auth_method, api_key_hash, created_at
  `;
  return row ? rowToUser(row) : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM users WHERE id = ${id}
  `;
  return result.count > 0;
}

function rowToUser(row: Record<string, unknown>): DbUser {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    email: row.email as string,
    linearUserId: (row.linear_user_id as string) ?? null,
    authMethod: row.auth_method as string,
    apiKeyHash: (row.api_key_hash as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

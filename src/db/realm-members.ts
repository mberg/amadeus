// ABOUTME: CRUD operations for the realm_members table.
// ABOUTME: Manages user membership and roles within realms.

import { sql } from "bun";

export interface RealmMember {
  realmId: string;
  userId: string;
  role: string;
  linearUserId: string | null;
}

export async function addRealmMember(realmId: string, userId: string, role: string): Promise<RealmMember> {
  const [row] = await sql`
    INSERT INTO realm_members (realm_id, user_id, role)
    VALUES (${realmId}, ${userId}, ${role})
    ON CONFLICT (realm_id, user_id) DO UPDATE SET role = ${role}
    RETURNING realm_id, user_id, role, linear_user_id
  `;
  return { realmId: row.realm_id, userId: row.user_id, role: row.role, linearUserId: row.linear_user_id ?? null };
}

export async function getRealmMembers(realmId: string): Promise<RealmMember[]> {
  const rows = await sql`
    SELECT realm_id, user_id, role, linear_user_id FROM realm_members WHERE realm_id = ${realmId}
  `;
  return rows.map((row) => ({ realmId: row.realm_id, userId: row.user_id, role: row.role, linearUserId: row.linear_user_id ?? null }));
}

export async function getRealmMemberRole(realmId: string, userId: string): Promise<string | null> {
  const [row] = await sql`
    SELECT role FROM realm_members WHERE realm_id = ${realmId} AND user_id = ${userId}
  `;
  return row?.role ?? null;
}

export async function getUserRealms(userId: string): Promise<RealmMember[]> {
  const rows = await sql`
    SELECT realm_id, user_id, role, linear_user_id FROM realm_members WHERE user_id = ${userId}
  `;
  return rows.map((row) => ({ realmId: row.realm_id, userId: row.user_id, role: row.role, linearUserId: row.linear_user_id ?? null }));
}

export async function updateRealmMemberLinearId(realmId: string, userId: string, linearUserId: string): Promise<void> {
  await sql`
    UPDATE realm_members SET linear_user_id = ${linearUserId}
    WHERE realm_id = ${realmId} AND user_id = ${userId}
  `;
}

export async function getUserByRealmLinearId(realmId: string, linearUserId: string): Promise<{ userId: string } | null> {
  const [row] = await sql`
    SELECT user_id FROM realm_members
    WHERE realm_id = ${realmId} AND linear_user_id = ${linearUserId}
  `;
  return row ? { userId: row.user_id } : null;
}

export async function removeRealmMember(realmId: string, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM realm_members WHERE realm_id = ${realmId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

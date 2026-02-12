// ABOUTME: CRUD operations for the org_members table.
// ABOUTME: Manages user membership and roles within organizations.

import { sql } from "bun";

export interface OrgMember {
  orgId: string;
  userId: string;
  role: string;
}

export async function addOrgMember(orgId: string, userId: string, role: string): Promise<OrgMember> {
  const [row] = await sql`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${orgId}, ${userId}, ${role})
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = ${role}
    RETURNING org_id, user_id, role
  `;
  return { orgId: row.org_id, userId: row.user_id, role: row.role };
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const rows = await sql`
    SELECT org_id, user_id, role FROM org_members WHERE org_id = ${orgId}
  `;
  return rows.map((row) => ({ orgId: row.org_id, userId: row.user_id, role: row.role }));
}

export async function getOrgMemberRole(orgId: string, userId: string): Promise<string | null> {
  const [row] = await sql`
    SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  return row?.role ?? null;
}

export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

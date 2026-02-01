// ABOUTME: Tests for org_members CRUD operations.
// ABOUTME: Validates adding, listing, role lookup, and removal of org members.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import { addOrgMember, getOrgMembers, getOrgMemberRole, removeOrgMember } from "./org-members";

const TEST_ORG = "test-org-members";
let userId: string;

describe("org-members", () => {
  beforeAll(async () => {
    await migrate();
    await sql`INSERT INTO organizations (org_id) VALUES (${TEST_ORG}) ON CONFLICT DO NOTHING`;
    const [userRow] = await sql`INSERT INTO users (org_id, name, email, auth_method) VALUES (${TEST_ORG}, 'Test', 't@t.com', 'api_key') RETURNING id`;
    userId = userRow.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM org_members WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
    await sql.close();
  });

  test("addOrgMember inserts a member", async () => {
    const member = await addOrgMember(TEST_ORG, userId, "admin");
    expect(member.orgId).toBe(TEST_ORG);
    expect(member.userId).toBe(userId);
    expect(member.role).toBe("admin");
  });

  test("addOrgMember upserts role on conflict", async () => {
    const member = await addOrgMember(TEST_ORG, userId, "member");
    expect(member.role).toBe("member");
  });

  test("getOrgMembers returns all members in org", async () => {
    const members = await getOrgMembers(TEST_ORG);
    expect(members.length).toBeGreaterThanOrEqual(1);
    const found = members.find((m) => m.userId === userId);
    expect(found).toBeDefined();
    expect(found!.role).toBe("member");
  });

  test("getOrgMemberRole returns role for existing member", async () => {
    const role = await getOrgMemberRole(TEST_ORG, userId);
    expect(role).toBe("member");
  });

  test("getOrgMemberRole returns null for non-member", async () => {
    const role = await getOrgMemberRole(TEST_ORG, "00000000-0000-0000-0000-000000000000");
    expect(role).toBeNull();
  });

  test("removeOrgMember deletes and returns true", async () => {
    const removed = await removeOrgMember(TEST_ORG, userId);
    expect(removed).toBe(true);
  });

  test("removeOrgMember returns false for non-existent member", async () => {
    const removed = await removeOrgMember(TEST_ORG, userId);
    expect(removed).toBe(false);
  });

  test("getOrgMembers returns empty after removal", async () => {
    const members = await getOrgMembers(TEST_ORG);
    const found = members.find((m) => m.userId === userId);
    expect(found).toBeUndefined();
  });
});

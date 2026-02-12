// ABOUTME: Tests for realm_members table CRUD operations.
// ABOUTME: Validates add, list, role lookup, and removal for user-to-realm membership.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import { createRealm } from "./realms";
import { createUser } from "./users";
import {
  addRealmMember,
  getRealmMembers,
  getRealmMemberRole,
  removeRealmMember,
  getUserRealms,
} from "./realm-members";

const TEST_ORG = "test-org-realm-members";

let realmId: string;
let userId1: string;
let userId2: string;

beforeAll(async () => {
  await migrate();
  await sql`
    INSERT INTO organizations (org_id)
    VALUES (${TEST_ORG})
    ON CONFLICT (org_id) DO NOTHING
  `;

  const realm = await createRealm({
    orgId: TEST_ORG,
    name: "members-test-realm",
    linearWorkspace: "members-ws",
  });
  realmId = realm.id;

  const user1 = await createUser({
    orgId: TEST_ORG,
    name: "Alice",
    email: "alice@test.com",
    authMethod: "api_key",
  });
  userId1 = user1.id;

  const user2 = await createUser({
    orgId: TEST_ORG,
    name: "Bob",
    email: "bob@test.com",
    authMethod: "api_key",
  });
  userId2 = user2.id;
});

afterAll(async () => {
  await sql`DELETE FROM realm_members WHERE realm_id = ${realmId}`;
  await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;
});

describe("realm_members CRUD", () => {
  test("addRealmMember inserts and returns membership", async () => {
    const member = await addRealmMember(realmId, userId1, "member");

    expect(member.realmId).toBe(realmId);
    expect(member.userId).toBe(userId1);
    expect(member.role).toBe("member");
  });

  test("addRealmMember upserts role on conflict", async () => {
    await addRealmMember(realmId, userId1, "member");
    const updated = await addRealmMember(realmId, userId1, "admin");

    expect(updated.role).toBe("admin");
  });

  test("getRealmMembers returns all members of a realm", async () => {
    await sql`DELETE FROM realm_members WHERE realm_id = ${realmId}`;

    await addRealmMember(realmId, userId1, "member");
    await addRealmMember(realmId, userId2, "admin");

    const members = await getRealmMembers(realmId);
    expect(members.length).toBe(2);
    expect(members.map((m) => m.userId).sort()).toEqual([userId1, userId2].sort());
  });

  test("getRealmMembers returns empty array for realm with no members", async () => {
    const otherRealm = await createRealm({
      orgId: TEST_ORG,
      name: "empty-realm",
      linearWorkspace: "empty-ws",
    });

    const members = await getRealmMembers(otherRealm.id);
    expect(members).toEqual([]);
  });

  test("getRealmMemberRole returns role for existing member", async () => {
    await sql`DELETE FROM realm_members WHERE realm_id = ${realmId}`;
    await addRealmMember(realmId, userId1, "admin");

    const role = await getRealmMemberRole(realmId, userId1);
    expect(role).toBe("admin");
  });

  test("getRealmMemberRole returns null for non-member", async () => {
    const role = await getRealmMemberRole(realmId, "00000000-0000-0000-0000-000000000000");
    expect(role).toBeNull();
  });

  test("getUserRealms returns all realms a user belongs to", async () => {
    await sql`DELETE FROM realm_members WHERE realm_id = ${realmId}`;

    const realm2 = await createRealm({
      orgId: TEST_ORG,
      name: "user-realms-test",
      linearWorkspace: "ur-ws",
    });

    await addRealmMember(realmId, userId1, "member");
    await addRealmMember(realm2.id, userId1, "admin");

    const realms = await getUserRealms(userId1);
    expect(realms.length).toBe(2);
    expect(realms.map((r) => r.realmId).sort()).toEqual([realmId, realm2.id].sort());
  });

  test("getUserRealms returns empty array for user with no memberships", async () => {
    const realms = await getUserRealms("00000000-0000-0000-0000-000000000000");
    expect(realms).toEqual([]);
  });

  test("removeRealmMember deletes membership and returns true", async () => {
    await sql`DELETE FROM realm_members WHERE realm_id = ${realmId}`;
    await addRealmMember(realmId, userId1, "member");

    const removed = await removeRealmMember(realmId, userId1);
    expect(removed).toBe(true);

    const role = await getRealmMemberRole(realmId, userId1);
    expect(role).toBeNull();
  });

  test("removeRealmMember returns false when membership does not exist", async () => {
    const removed = await removeRealmMember(realmId, "00000000-0000-0000-0000-000000000000");
    expect(removed).toBe(false);
  });

  test("realm deletion cascades to realm_members", async () => {
    const tempRealm = await createRealm({
      orgId: TEST_ORG,
      name: "cascade-test",
      linearWorkspace: "cascade-ws",
    });
    await addRealmMember(tempRealm.id, userId1, "member");

    await sql`DELETE FROM realms WHERE id = ${tempRealm.id}`;

    const members = await getRealmMembers(tempRealm.id);
    expect(members).toEqual([]);
  });
});

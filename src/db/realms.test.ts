// ABOUTME: Tests for realms table CRUD operations.
// ABOUTME: Validates create, read, lookup, update, and delete for multi-tenant realm records.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import {
  createRealm,
  getRealm,
  getRealmByName,
  getRealmsByOrg,
  updateRealm,
  deleteRealm,
} from "./realms";

const TEST_ORG = "test-org-realms";

beforeAll(async () => {
  await migrate();
  await sql`
    INSERT INTO organizations (org_id)
    VALUES (${TEST_ORG})
    ON CONFLICT (org_id) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;
});

describe("realms CRUD", () => {
  test("createRealm inserts and returns a realm", async () => {
    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "production",
      linearWorkspace: "acme-corp",
      claudeBotUserId: "bot-123",
    });

    expect(realm.id).toBeDefined();
    expect(realm.orgId).toBe(TEST_ORG);
    expect(realm.name).toBe("production");
    expect(realm.linearWorkspace).toBe("acme-corp");
    expect(realm.claudeBotUserId).toBe("bot-123");
    expect(realm.createdAt).toBeInstanceOf(Date);
  });

  test("createRealm works without optional fields", async () => {
    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "staging",
      linearWorkspace: "acme-staging",
    });

    expect(realm.id).toBeDefined();
    expect(realm.name).toBe("staging");
    expect(realm.claudeBotUserId).toBeNull();
  });

  test("createRealm enforces unique (org_id, name)", async () => {
    await createRealm({
      orgId: TEST_ORG,
      name: "unique-test",
      linearWorkspace: "ws-1",
    });

    expect(
      createRealm({
        orgId: TEST_ORG,
        name: "unique-test",
        linearWorkspace: "ws-2",
      })
    ).rejects.toThrow();
  });

  test("getRealm returns a realm by id", async () => {
    const created = await createRealm({
      orgId: TEST_ORG,
      name: "fetch-me",
      linearWorkspace: "fetch-ws",
    });

    const fetched = await getRealm(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("fetch-me");
    expect(fetched!.linearWorkspace).toBe("fetch-ws");
  });

  test("getRealm returns null for unknown id", async () => {
    const result = await getRealm("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  test("getRealmByName finds realm by org and name", async () => {
    await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;

    await createRealm({
      orgId: TEST_ORG,
      name: "by-name-test",
      linearWorkspace: "name-ws",
    });

    const found = await getRealmByName(TEST_ORG, "by-name-test");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("by-name-test");
    expect(found!.linearWorkspace).toBe("name-ws");
  });

  test("getRealmByName returns null when not found", async () => {
    const result = await getRealmByName(TEST_ORG, "nonexistent");
    expect(result).toBeNull();
  });

  test("getRealmsByOrg returns all realms in org", async () => {
    await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;

    await createRealm({ orgId: TEST_ORG, name: "first", linearWorkspace: "ws-a" });
    await createRealm({ orgId: TEST_ORG, name: "second", linearWorkspace: "ws-b" });

    const realms = await getRealmsByOrg(TEST_ORG);
    expect(realms.length).toBe(2);
    expect(realms.map((r) => r.name).sort()).toEqual(["first", "second"]);
  });

  test("getRealmsByOrg returns empty array for unknown org", async () => {
    const realms = await getRealmsByOrg("nonexistent-org");
    expect(realms).toEqual([]);
  });

  test("updateRealm updates fields and returns updated realm", async () => {
    await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;

    const created = await createRealm({
      orgId: TEST_ORG,
      name: "update-me",
      linearWorkspace: "old-ws",
    });

    const updated = await updateRealm(created.id, {
      name: "updated-name",
      linearWorkspace: "new-ws",
      claudeBotUserId: "new-bot",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("updated-name");
    expect(updated!.linearWorkspace).toBe("new-ws");
    expect(updated!.claudeBotUserId).toBe("new-bot");
  });

  test("updateRealm with partial fields only changes specified fields", async () => {
    const created = await createRealm({
      orgId: TEST_ORG,
      name: "partial-update",
      linearWorkspace: "keep-ws",
      claudeBotUserId: "keep-bot",
    });

    const updated = await updateRealm(created.id, {
      name: "new-name-only",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("new-name-only");
    expect(updated!.linearWorkspace).toBe("keep-ws");
    expect(updated!.claudeBotUserId).toBe("keep-bot");
  });

  test("updateRealm returns null for unknown id", async () => {
    const result = await updateRealm("00000000-0000-0000-0000-000000000000", {
      name: "nope",
    });
    expect(result).toBeNull();
  });

  test("deleteRealm removes realm and returns true", async () => {
    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "delete-me",
      linearWorkspace: "delete-ws",
    });

    const deleted = await deleteRealm(realm.id, TEST_ORG);
    expect(deleted).toBe(true);

    const after = await getRealm(realm.id);
    expect(after).toBeNull();
  });

  test("deleteRealm returns false for nonexistent realm", async () => {
    const result = await deleteRealm(
      "00000000-0000-0000-0000-000000000000",
      TEST_ORG
    );
    expect(result).toBe(false);
  });

  test("deleteRealm returns false when org_id does not match", async () => {
    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "wrong-org-delete",
      linearWorkspace: "wrong-ws",
    });

    const result = await deleteRealm(realm.id, "wrong-org");
    expect(result).toBe(false);

    const still = await getRealm(realm.id);
    expect(still).not.toBeNull();
  });
});

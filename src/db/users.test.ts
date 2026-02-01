// ABOUTME: Tests for users table CRUD operations.
// ABOUTME: Validates create, read, update, and delete against a real Postgres database.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import {
  createUser,
  getUser,
  getUserByLinearId,
  getUsersByOrg,
  updateUserLinearId,
  deleteUser,
} from "./users";

const TEST_ORG = "test-org-users";

describe("users", () => {
  beforeAll(async () => {
    await migrate();
    await sql`
      INSERT INTO organizations (org_id)
      VALUES (${TEST_ORG})
      ON CONFLICT (org_id) DO NOTHING
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
    await sql.close();
  });

  test("createUser inserts and returns user", async () => {
    const user = await createUser({
      orgId: TEST_ORG,
      name: "Alice",
      email: "alice@example.com",
      authMethod: "api_key",
      apiKeyHash: "hash-alice",
    });

    expect(user.id).toBeDefined();
    expect(user.orgId).toBe(TEST_ORG);
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.authMethod).toBe("api_key");
    expect(user.apiKeyHash).toBe("hash-alice");
    expect(user.linearUserId).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  test("getUser retrieves user by id", async () => {
    const created = await createUser({
      orgId: TEST_ORG,
      name: "Bob",
      email: "bob@example.com",
      authMethod: "api_key",
    });

    const fetched = await getUser(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Bob");
    expect(fetched!.email).toBe("bob@example.com");
  });

  test("getUser returns null for nonexistent id", async () => {
    const result = await getUser("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  test("getUsersByOrg returns all users in org", async () => {
    const users = await getUsersByOrg(TEST_ORG);
    expect(users.length).toBeGreaterThanOrEqual(2);
    for (const u of users) {
      expect(u.orgId).toBe(TEST_ORG);
    }
  });

  test("updateUserLinearId sets linear_user_id", async () => {
    const created = await createUser({
      orgId: TEST_ORG,
      name: "Carol",
      email: "carol@example.com",
      authMethod: "api_key",
    });

    const updated = await updateUserLinearId(created.id, "linear-carol-123");
    expect(updated).not.toBeNull();
    expect(updated!.linearUserId).toBe("linear-carol-123");

    const fetched = await getUser(created.id);
    expect(fetched!.linearUserId).toBe("linear-carol-123");
  });

  test("getUserByLinearId finds user by org + linear_user_id", async () => {
    // Carol was given a linear ID in the previous test
    const users = await getUsersByOrg(TEST_ORG);
    const carol = users.find((u) => u.name === "Carol");
    expect(carol).toBeDefined();

    const found = await getUserByLinearId(TEST_ORG, "linear-carol-123");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(carol!.id);
    expect(found!.name).toBe("Carol");
  });

  test("getUserByLinearId returns null when not found", async () => {
    const result = await getUserByLinearId(TEST_ORG, "nonexistent-linear-id");
    expect(result).toBeNull();
  });

  test("deleteUser removes user and returns true", async () => {
    const created = await createUser({
      orgId: TEST_ORG,
      name: "Dave",
      email: "dave@example.com",
      authMethod: "api_key",
    });

    const deleted = await deleteUser(created.id);
    expect(deleted).toBe(true);

    const fetched = await getUser(created.id);
    expect(fetched).toBeNull();
  });

  test("deleteUser returns false for nonexistent id", async () => {
    const deleted = await deleteUser("00000000-0000-0000-0000-000000000000");
    expect(deleted).toBe(false);
  });
});

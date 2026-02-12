// ABOUTME: Tests for resolveLinearApiKey fallback chain.
// ABOUTME: Validates per-user PAT resolution from DB secrets.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate, setSecret, deleteSecret } from "./db";
import { createUser, deleteUser } from "./db/users";
import { createRealm, deleteRealm } from "./db/realms";
import { createProject, deleteProject } from "./db/projects";
import { resolveLinearApiKey } from "./config";

const TEST_ORG = "test-org-resolve-pat";

let realmId: string;
let userId: string;
let projectId: string;

describe("resolveLinearApiKey", () => {
  beforeAll(async () => {
    await migrate();
    await sql`
      INSERT INTO organizations (org_id)
      VALUES (${TEST_ORG})
      ON CONFLICT (org_id) DO NOTHING
    `;

    // Create a test realm
    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "test-realm",
      linearWorkspace: "test-ws",
    });
    realmId = realm.id;

    // Create a project linked to the realm with a team key
    const project = await createProject({
      orgId: TEST_ORG,
      name: "Test Project",
      linearTeamKey: "TPAT",
      realmId: realm.id,
    });
    projectId = project.id;

    // Create a user with a Linear user ID
    const user = await createUser({
      orgId: TEST_ORG,
      name: "Test User",
      email: "testpat@example.com",
      authMethod: "api_key",
      linearUserId: "linear-user-pat-123",
    });
    userId = user.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG}`;
    await deleteProject(projectId, TEST_ORG);
    await deleteUser(userId);
    await deleteRealm(realmId, TEST_ORG);
    await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  });

  test("returns realm-specific PAT when available", async () => {
    const secretKey = `user:${userId}:realm:${realmId}:linear_pat`;
    await setSecret(TEST_ORG, secretKey, "realm-specific-pat-value");

    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "linear-user-pat-123");
    expect(result).toBe("realm-specific-pat-value");

    await deleteSecret(TEST_ORG, secretKey);
  });

  test("falls back to global PAT when no realm-specific PAT exists", async () => {
    const secretKey = `user:${userId}:linear_pat`;
    await setSecret(TEST_ORG, secretKey, "global-pat-value");

    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "linear-user-pat-123");
    expect(result).toBe("global-pat-value");

    await deleteSecret(TEST_ORG, secretKey);
  });

  test("returns null when no assignee and no YAML apiKey", async () => {
    const result = await resolveLinearApiKey(TEST_ORG, "TPAT");
    expect(result).toBeNull();
  });

  test("returns null when assignee has no PAT stored", async () => {
    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "linear-user-pat-123");
    expect(result).toBeNull();
  });

  test("returns null when assignee Linear ID not found in DB", async () => {
    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "nonexistent-linear-id");
    expect(result).toBeNull();
  });

  test("returns null for unknown team key with no assignee", async () => {
    const result = await resolveLinearApiKey(TEST_ORG, "UNKNOWN");
    expect(result).toBeNull();
  });
});

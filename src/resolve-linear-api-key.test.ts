// ABOUTME: Tests for resolveLinearApiKey fallback chain.
// ABOUTME: Validates per-user PAT resolution from DB secrets and realm member lookup.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate, setSecret, deleteSecret } from "./db";
import { createUser, deleteUser } from "./db/users";
import { createRealm, deleteRealm } from "./db/realms";
import { createProject, deleteProject } from "./db/projects";
import { addRealmMember, removeRealmMember, updateRealmMemberLinearId } from "./db/realm-members";
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

    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "test-realm",
      linearWorkspace: "test-ws",
    });
    realmId = realm.id;

    const project = await createProject({
      orgId: TEST_ORG,
      name: "Test Project",
      linearTeamKey: "TPAT",
      realmId: realm.id,
    });
    projectId = project.id;

    const user = await createUser({
      orgId: TEST_ORG,
      name: "Test User",
      email: "testpat@example.com",
      authMethod: "api_key",
      linearUserId: "linear-user-pat-123",
    });
    userId = user.id;

    // Add user as realm member with per-realm Linear identity
    await addRealmMember(realmId, userId, "member");
    await updateRealmMemberLinearId(realmId, userId, "realm-linear-id-456");
  });

  afterAll(async () => {
    await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG}`;
    await removeRealmMember(realmId, userId);
    await deleteProject(projectId, TEST_ORG);
    await deleteUser(userId);
    await deleteRealm(realmId, TEST_ORG);
    await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  });

  test("resolves PAT via realm member Linear ID", async () => {
    const secretKey = `user:${userId}:realm:${realmId}:linear_pat`;
    await setSecret(TEST_ORG, secretKey, "realm-member-pat-value");

    // Use the per-realm Linear ID, not the user's global one
    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "realm-linear-id-456");
    expect(result).toBe("realm-member-pat-value");

    await deleteSecret(TEST_ORG, secretKey);
  });

  test("falls back to legacy user lookup when realm member not found", async () => {
    const secretKey = `user:${userId}:realm:${realmId}:linear_pat`;
    await setSecret(TEST_ORG, secretKey, "legacy-lookup-pat");

    // Use the global linear_user_id (legacy path)
    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "linear-user-pat-123");
    expect(result).toBe("legacy-lookup-pat");

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

  test("returns null when assignee not found in any lookup", async () => {
    const result = await resolveLinearApiKey(TEST_ORG, "TPAT", "completely-unknown-id");
    expect(result).toBeNull();
  });

  test("returns null for unknown team key", async () => {
    const result = await resolveLinearApiKey(TEST_ORG, "UNKNOWN");
    expect(result).toBeNull();
  });
});

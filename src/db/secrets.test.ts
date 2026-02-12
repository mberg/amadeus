// ABOUTME: Tests for secret key listing by prefix.
// ABOUTME: Validates listSecretKeys returns matching key names without values.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate, setSecret, deleteSecret, listSecretKeys } from "./index";

const TEST_ORG = "test-org-secrets";

describe("listSecretKeys", () => {
  beforeAll(async () => {
    await migrate();
    await sql`
      INSERT INTO organizations (org_id)
      VALUES (${TEST_ORG})
      ON CONFLICT (org_id) DO NOTHING
    `;

    await setSecret(TEST_ORG, "user:u1:realm:r1:linear_pat", "pat-value-1");
    await setSecret(TEST_ORG, "user:u1:realm:r2:linear_pat", "pat-value-2");
    await setSecret(TEST_ORG, "user:u1:linear_pat", "global-pat");
    await setSecret(TEST_ORG, "user:u2:linear_pat", "other-user-pat");
    await setSecret(TEST_ORG, "realm:r1:webhook_secret", "webhook-secret");
  });

  afterAll(async () => {
    await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  });

  test("returns keys matching prefix", async () => {
    const keys = await listSecretKeys(TEST_ORG, "user:u1:");
    expect(keys).toContain("user:u1:realm:r1:linear_pat");
    expect(keys).toContain("user:u1:realm:r2:linear_pat");
    expect(keys).toContain("user:u1:linear_pat");
    expect(keys).toHaveLength(3);
  });

  test("does not return keys from other prefixes", async () => {
    const keys = await listSecretKeys(TEST_ORG, "user:u1:");
    expect(keys).not.toContain("user:u2:linear_pat");
    expect(keys).not.toContain("realm:r1:webhook_secret");
  });

  test("returns empty array when no keys match", async () => {
    const keys = await listSecretKeys(TEST_ORG, "user:nonexistent:");
    expect(keys).toEqual([]);
  });

  test("scopes by org_id", async () => {
    const keys = await listSecretKeys("other-org", "user:u1:");
    expect(keys).toEqual([]);
  });
});

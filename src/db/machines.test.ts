// ABOUTME: Tests for extended machine operations (owner, permission, status).
// ABOUTME: Validates get, update owner/permission/status against a real Postgres database.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import {
  getMachineWithPermission,
  updateMachineOwner,
  updateMachinePermission,
  updateMachineStatus,
} from "./machines";

const TEST_ORG = "test-org-mach";
let userId: string;
let machineId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES (${TEST_ORG}, 'Test') ON CONFLICT DO NOTHING`;
  const [userRow] = await sql`INSERT INTO users (org_id, name, email, auth_method) VALUES (${TEST_ORG}, 'Test', 't@t.com', 'api_key') RETURNING id`;
  userId = userRow.id;
  const [machineRow] = await sql`INSERT INTO machines (org_id, name, url, api_key_hash) VALUES (${TEST_ORG}, 'claudius', 'http://localhost:7777', 'hash789') RETURNING id`;
  machineId = machineRow.id;
});

afterAll(async () => {
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
});

describe("machines extended", () => {
  test("getMachineWithPermission returns machine with default permission 'public'", async () => {
    const machine = await getMachineWithPermission(machineId);
    expect(machine).not.toBeNull();
    expect(machine!.id).toBe(machineId);
    expect(machine!.orgId).toBe(TEST_ORG);
    expect(machine!.name).toBe("claudius");
    expect(machine!.url).toBe("http://localhost:7777");
    expect(machine!.apiKeyHash).toBe("hash789");
    expect(machine!.ownerUserId).toBeNull();
    expect(machine!.permission).toBe("public");
    expect(machine!.status).toBe("unknown");
    expect(machine!.createdAt).toBeInstanceOf(Date);
    expect(machine!.lastSeen).toBeNull();
  });

  test("updateMachineOwner sets owner", async () => {
    const updated = await updateMachineOwner(machineId, userId);
    expect(updated).not.toBeNull();
    expect(updated!.ownerUserId).toBe(userId);

    const fetched = await getMachineWithPermission(machineId);
    expect(fetched!.ownerUserId).toBe(userId);
  });

  test("updateMachinePermission changes permission to 'allowed'", async () => {
    const updated = await updateMachinePermission(machineId, "allowed");
    expect(updated).not.toBeNull();
    expect(updated!.permission).toBe("allowed");

    const fetched = await getMachineWithPermission(machineId);
    expect(fetched!.permission).toBe("allowed");
  });

  test("updateMachineStatus changes status and updates last_seen", async () => {
    const updated = await updateMachineStatus(machineId, "online");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("online");
    expect(updated!.lastSeen).toBeInstanceOf(Date);

    const fetched = await getMachineWithPermission(machineId);
    expect(fetched!.status).toBe("online");
    expect(fetched!.lastSeen).toBeInstanceOf(Date);
  });
});

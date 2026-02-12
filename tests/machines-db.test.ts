// ABOUTME: Tests for Postgres-backed machine registry loading.
// ABOUTME: Verifies machines load from Postgres and heartbeats update last_seen.

import { test, expect, beforeAll, beforeEach } from "bun:test";
import { sql } from "bun";
import { migrate, ensureOrg, createMachine, getMachines, updateMachineLastSeen } from "../src/db";
import { MachineRegistry } from "../src/hub/registry";

const TEST_ORG = "test-machines-org";

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  await ensureOrg(TEST_ORG);
});

test("loadFromDb populates registry from Postgres machines", async () => {
  await createMachine(TEST_ORG, "machine-a", "https://a.example.com", "hash-a");
  await createMachine(TEST_ORG, "machine-b", "https://b.example.com", "hash-b");

  const registry = new MachineRegistry();
  const dbMachines = await getMachines(TEST_ORG);
  registry.loadFromDb(dbMachines);

  const all = registry.getAll();
  expect(all.length).toBe(2);

  const a = registry.get("machine-a");
  expect(a).toBeDefined();
  expect(a!.url).toBe("https://a.example.com");

  const b = registry.get("machine-b");
  expect(b).toBeDefined();
  expect(b!.url).toBe("https://b.example.com");
});

test("loadFromDb sets machines as unknown status", async () => {
  await createMachine(TEST_ORG, "fresh", "https://fresh.example.com", "hash-f");

  const registry = new MachineRegistry();
  const dbMachines = await getMachines(TEST_ORG);
  registry.loadFromDb(dbMachines);

  const machine = registry.get("fresh");
  expect(machine!.status).toBe("unknown");
});

test("updateMachineLastSeen updates timestamp in Postgres", async () => {
  const machine = await createMachine(TEST_ORG, "seen", "https://seen.example.com", "hash-s");
  expect(machine.lastSeen).toBeNull();

  await updateMachineLastSeen(machine.id);

  const machines = await getMachines(TEST_ORG);
  expect(machines[0].lastSeen).not.toBeNull();
});

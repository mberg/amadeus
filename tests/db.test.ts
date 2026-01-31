// ABOUTME: Tests for Postgres data access layer.
// ABOUTME: Requires a running Postgres instance (see docker setup in CLAUDE.md).

import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { sql } from "bun";
import {
  migrate,
  ensureOrg,
  getConfigYaml,
  saveConfigYaml,
  getMachines,
  createMachine,
  deleteMachine,
  updateMachineLastSeen,
  authenticateMachine,
  getSecret,
  setSecret,
  deleteSecret,
  recordCompletedTask,
  getCompletedTasks,
  getCompletedTaskCount,
  close,
} from "../src/db";

const TEST_ORG = "test-org";

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  // Clean up test data between tests
  await sql`DELETE FROM completed_tasks WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  await ensureOrg(TEST_ORG);
});

afterAll(async () => {
  await sql`DELETE FROM completed_tasks WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  await close();
});

// --- Organizations ---

test("migrate creates default org", async () => {
  const [row] = await sql`SELECT org_id FROM organizations WHERE org_id = 'default'`;
  expect(row.org_id).toBe("default");
});

test("ensureOrg is idempotent", async () => {
  await ensureOrg(TEST_ORG);
  await ensureOrg(TEST_ORG);
  const rows = await sql`SELECT org_id FROM organizations WHERE org_id = ${TEST_ORG}`;
  expect(rows.length).toBe(1);
});

// --- Config ---

test("getConfigYaml returns null for org without config", async () => {
  const yaml = await getConfigYaml(TEST_ORG);
  expect(yaml).toBeNull();
});

test("saveConfigYaml and getConfigYaml round-trip", async () => {
  const testYaml = "realms:\n  test:\n    linearWorkspace: test\n";
  await saveConfigYaml(TEST_ORG, testYaml);
  const result = await getConfigYaml(TEST_ORG);
  expect(result).toBe(testYaml);
});

test("saveConfigYaml overwrites existing config", async () => {
  await saveConfigYaml(TEST_ORG, "old: config");
  await saveConfigYaml(TEST_ORG, "new: config");
  const result = await getConfigYaml(TEST_ORG);
  expect(result).toBe("new: config");
});

// --- Machines ---

test("createMachine and getMachines", async () => {
  const machine = await createMachine(TEST_ORG, "test-machine", "https://test.local", "hash123");
  expect(machine.name).toBe("test-machine");
  expect(machine.url).toBe("https://test.local");
  expect(machine.orgId).toBe(TEST_ORG);
  expect(machine.id).toBeTruthy();

  const machines = await getMachines(TEST_ORG);
  expect(machines.length).toBe(1);
  expect(machines[0].name).toBe("test-machine");
});

test("deleteMachine removes machine", async () => {
  const machine = await createMachine(TEST_ORG, "to-delete", "https://test.local", "hash456");
  const deleted = await deleteMachine(machine.id, TEST_ORG);
  expect(deleted).toBe(true);

  const machines = await getMachines(TEST_ORG);
  expect(machines.length).toBe(0);
});

test("deleteMachine returns false for wrong org", async () => {
  const machine = await createMachine(TEST_ORG, "wrong-org", "https://test.local", "hash789");
  const deleted = await deleteMachine(machine.id, "other-org");
  expect(deleted).toBe(false);
});

test("authenticateMachine finds machine by api key hash", async () => {
  await createMachine(TEST_ORG, "auth-machine", "https://test.local", "auth-hash-123");
  const result = await authenticateMachine("auth-hash-123");
  expect(result).not.toBeNull();
  expect(result!.orgId).toBe(TEST_ORG);
  expect(result!.machineName).toBe("auth-machine");
});

test("authenticateMachine returns null for unknown key", async () => {
  const result = await authenticateMachine("nonexistent-hash");
  expect(result).toBeNull();
});

test("updateMachineLastSeen updates timestamp", async () => {
  const machine = await createMachine(TEST_ORG, "seen-machine", "https://test.local", "seen-hash");
  expect(machine.lastSeen).toBeNull();

  await updateMachineLastSeen(machine.id);
  const machines = await getMachines(TEST_ORG);
  expect(machines[0].lastSeen).not.toBeNull();
});

// --- Secrets ---

test("getSecret returns null for missing secret", async () => {
  const val = await getSecret(TEST_ORG, "NONEXISTENT");
  expect(val).toBeNull();
});

test("setSecret and getSecret round-trip", async () => {
  await setSecret(TEST_ORG, "MY_API_KEY", "encrypted-value-123");
  const val = await getSecret(TEST_ORG, "MY_API_KEY");
  expect(val).toBe("encrypted-value-123");
});

test("setSecret upserts on conflict", async () => {
  await setSecret(TEST_ORG, "MY_KEY", "old-value");
  await setSecret(TEST_ORG, "MY_KEY", "new-value");
  const val = await getSecret(TEST_ORG, "MY_KEY");
  expect(val).toBe("new-value");
});

test("deleteSecret removes secret", async () => {
  await setSecret(TEST_ORG, "TO_DELETE", "value");
  const deleted = await deleteSecret(TEST_ORG, "TO_DELETE");
  expect(deleted).toBe(true);

  const val = await getSecret(TEST_ORG, "TO_DELETE");
  expect(val).toBeNull();
});

// --- Completed Tasks ---

test("recordCompletedTask and getCompletedTasks", async () => {
  await recordCompletedTask(TEST_ORG, {
    key: "ONA-123",
    issueId: "issue-1",
    issueIdentifier: "ONA-123",
    issueTitle: "Test task",
    linearProject: "Amadeus",
    completedAt: new Date("2026-01-30T12:00:00Z"),
    completionReason: "done",
    finalLinearState: "Done",
    duration: 60000,
  });

  const tasks = await getCompletedTasks(TEST_ORG);
  expect(tasks.length).toBe(1);
  expect(tasks[0].key).toBe("ONA-123");
  expect(tasks[0].issueTitle).toBe("Test task");
  expect(tasks[0].completionReason).toBe("done");
  expect(tasks[0].duration).toBe(60000);
});

test("getCompletedTasks respects pagination", async () => {
  for (let i = 0; i < 5; i++) {
    await recordCompletedTask(TEST_ORG, {
      key: `ONA-${i}`,
      issueId: `issue-${i}`,
      issueIdentifier: `ONA-${i}`,
      issueTitle: `Task ${i}`,
      completedAt: new Date(Date.now() - i * 1000),
      completionReason: "done",
      duration: 1000,
    });
  }

  const page1 = await getCompletedTasks(TEST_ORG, 2, 0);
  expect(page1.length).toBe(2);

  const page2 = await getCompletedTasks(TEST_ORG, 2, 2);
  expect(page2.length).toBe(2);
  expect(page2[0].key).not.toBe(page1[0].key);
});

test("getCompletedTaskCount returns correct count", async () => {
  expect(await getCompletedTaskCount(TEST_ORG)).toBe(0);

  await recordCompletedTask(TEST_ORG, {
    key: "ONA-1",
    issueId: "issue-1",
    issueIdentifier: "ONA-1",
    issueTitle: "Task 1",
    completedAt: new Date(),
    completionReason: "done",
    duration: 1000,
  });

  expect(await getCompletedTaskCount(TEST_ORG)).toBe(1);
});

test("completed tasks are org-scoped", async () => {
  await recordCompletedTask(TEST_ORG, {
    key: "ONA-1",
    issueId: "issue-1",
    issueIdentifier: "ONA-1",
    issueTitle: "Task 1",
    completedAt: new Date(),
    completionReason: "done",
    duration: 1000,
  });

  const defaultTasks = await getCompletedTasks("default");
  expect(defaultTasks.length).toBe(0);

  const orgTasks = await getCompletedTasks(TEST_ORG);
  expect(orgTasks.length).toBe(1);
});

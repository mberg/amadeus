// ABOUTME: Tests for machine_projects and machine_access CRUD operations.
// ABOUTME: Validates add, list, join-query, and remove against a real Postgres database.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import {
  addMachineProject,
  getMachineProjects,
  getMachinesForProject,
  removeMachineProject,
  addMachineAccess,
  getMachineAccessList,
  removeMachineAccess,
  getMachinesForUser,
  userHasMachineAccess,
} from "./machine-projects";

const TEST_ORG = "test-org-mp";
let userId: string;
let machineId: string;
let projectId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id) VALUES (${TEST_ORG}) ON CONFLICT DO NOTHING`;
  const [userRow] = await sql`INSERT INTO users (org_id, name, email, auth_method) VALUES (${TEST_ORG}, 'Test', 't@t.com', 'api_key') RETURNING id`;
  userId = userRow.id;
  const [machineRow] = await sql`INSERT INTO machines (org_id, name, url, api_key_hash) VALUES (${TEST_ORG}, 'test-machine', 'http://localhost:9999', 'hash123') RETURNING id`;
  machineId = machineRow.id;
  const [projectRow] = await sql`INSERT INTO projects (org_id, name, linear_team_key) VALUES (${TEST_ORG}, 'TestProj', 'TP') RETURNING id`;
  projectId = projectRow.id;
});

afterAll(async () => {
  await sql`DELETE FROM machine_access WHERE machine_id = ${machineId}`;
  await sql`DELETE FROM machine_projects WHERE machine_id = ${machineId}`;
  await sql`DELETE FROM project_members WHERE machine_id = ${machineId}`;
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
});

describe("machine-projects", () => {
  test("addMachineProject inserts a mapping", async () => {
    const entry = await addMachineProject(machineId, projectId, "/home/dev/repo");
    expect(entry.machineId).toBe(machineId);
    expect(entry.projectId).toBe(projectId);
    expect(entry.localRepoPath).toBe("/home/dev/repo");
  });

  test("addMachineProject upserts local_repo_path on conflict", async () => {
    const entry = await addMachineProject(machineId, projectId, "/updated/path");
    expect(entry.localRepoPath).toBe("/updated/path");
  });

  test("getMachineProjects returns all projects for a machine", async () => {
    const projects = await getMachineProjects(machineId);
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const found = projects.find((p) => p.projectId === projectId);
    expect(found).toBeDefined();
    expect(found!.localRepoPath).toBe("/updated/path");
  });

  test("getMachinesForProject returns machines with join data", async () => {
    const machines = await getMachinesForProject(projectId);
    expect(machines.length).toBeGreaterThanOrEqual(1);
    const found = machines.find((m) => m.machineId === machineId);
    expect(found).toBeDefined();
    expect(found!.projectId).toBe(projectId);
    expect(found!.localRepoPath).toBe("/updated/path");
    expect(found!.machineUrl).toBe("http://localhost:9999");
    expect(found!.machineName).toBe("test-machine");
  });

  test("removeMachineProject deletes and returns true", async () => {
    const removed = await removeMachineProject(machineId, projectId);
    expect(removed).toBe(true);
  });

  test("removeMachineProject returns false for non-existent mapping", async () => {
    const removed = await removeMachineProject(machineId, projectId);
    expect(removed).toBe(false);
  });

  test("getMachineProjects returns empty after removal", async () => {
    const projects = await getMachineProjects(machineId);
    const found = projects.find((p) => p.projectId === projectId);
    expect(found).toBeUndefined();
  });
});

describe("machine-access", () => {
  test("addMachineAccess inserts an access entry", async () => {
    const entry = await addMachineAccess(machineId, userId);
    expect(entry.machineId).toBe(machineId);
    expect(entry.userId).toBe(userId);
  });

  test("addMachineAccess does nothing on conflict", async () => {
    const entry = await addMachineAccess(machineId, userId);
    expect(entry.machineId).toBe(machineId);
    expect(entry.userId).toBe(userId);
  });

  test("getMachineAccessList returns all access entries", async () => {
    const entries = await getMachineAccessList(machineId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const found = entries.find((e) => e.userId === userId);
    expect(found).toBeDefined();
  });

  test("removeMachineAccess deletes and returns true", async () => {
    const removed = await removeMachineAccess(machineId, userId);
    expect(removed).toBe(true);
  });

  test("removeMachineAccess returns false for non-existent entry", async () => {
    const removed = await removeMachineAccess(machineId, userId);
    expect(removed).toBe(false);
  });

  test("getMachineAccessList returns empty after removal", async () => {
    const entries = await getMachineAccessList(machineId);
    const found = entries.find((e) => e.userId === userId);
    expect(found).toBeUndefined();
  });
});

describe("machine access by user", () => {
  beforeAll(async () => {
    await addMachineAccess(machineId, userId);
  });

  afterAll(async () => {
    await removeMachineAccess(machineId, userId);
  });

  test("getMachinesForUser returns machine names the user has access to", async () => {
    const names = await getMachinesForUser(userId);
    expect(names).toContain("test-machine");
  });

  test("getMachinesForUser returns empty for user with no access", async () => {
    const [otherUserRow] = await sql`INSERT INTO users (org_id, name, email, auth_method) VALUES (${TEST_ORG}, 'Other', 'other@t.com', 'api_key') RETURNING id`;
    const names = await getMachinesForUser(otherUserRow.id);
    expect(names).toHaveLength(0);
    await sql`DELETE FROM users WHERE id = ${otherUserRow.id}`;
  });

  test("userHasMachineAccess returns true when user has access", async () => {
    const hasAccess = await userHasMachineAccess("test-machine", userId);
    expect(hasAccess).toBe(true);
  });

  test("userHasMachineAccess returns false when user has no access", async () => {
    const hasAccess = await userHasMachineAccess("test-machine", crypto.randomUUID());
    expect(hasAccess).toBe(false);
  });

  test("userHasMachineAccess returns false for nonexistent machine", async () => {
    const hasAccess = await userHasMachineAccess("nonexistent-machine", userId);
    expect(hasAccess).toBe(false);
  });
});

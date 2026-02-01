// ABOUTME: Tests for project_members CRUD operations.
// ABOUTME: Validates adding, listing, machine routing lookup, and removal of project members.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import {
  addProjectMember,
  getProjectMembers,
  getProjectMemberMachine,
  removeProjectMember,
} from "./project-members";

const TEST_ORG = "test-org-pm";
let userId: string;
let machineId: string;
let projectId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES (${TEST_ORG}, 'Test') ON CONFLICT DO NOTHING`;
  const [userRow] = await sql`INSERT INTO users (org_id, name, email, auth_method) VALUES (${TEST_ORG}, 'Test', 't@t.com', 'api_key') RETURNING id`;
  userId = userRow.id;
  const [machineRow] = await sql`INSERT INTO machines (org_id, name, url, api_key_hash) VALUES (${TEST_ORG}, 'test-machine', 'http://localhost:9998', 'hash456') RETURNING id`;
  machineId = machineRow.id;
  const [projectRow] = await sql`INSERT INTO projects (org_id, name, linear_team_key) VALUES (${TEST_ORG}, 'PM-Proj', 'PM') RETURNING id`;
  projectId = projectRow.id;
  await sql`INSERT INTO machine_projects (machine_id, project_id, local_repo_path) VALUES (${machineId}, ${projectId}, '/home/test/repos/pm-proj')`;
});

afterAll(async () => {
  await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
  await sql`DELETE FROM machine_projects WHERE project_id = ${projectId}`;
  await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  await sql.close();
});

describe("project-members", () => {
  test("addProjectMember inserts a member", async () => {
    const member = await addProjectMember(projectId, userId, machineId);
    expect(member.projectId).toBe(projectId);
    expect(member.userId).toBe(userId);
    expect(member.machineId).toBe(machineId);
  });

  test("addProjectMember upserts machine_id on conflict", async () => {
    const member = await addProjectMember(projectId, userId, machineId);
    expect(member.machineId).toBe(machineId);
  });

  test("getProjectMembers returns all members for a project", async () => {
    const members = await getProjectMembers(projectId);
    expect(members.length).toBeGreaterThanOrEqual(1);
    const found = members.find((m) => m.userId === userId);
    expect(found).toBeDefined();
    expect(found!.machineId).toBe(machineId);
  });

  test("getProjectMemberMachine returns machine routing info", async () => {
    const result = await getProjectMemberMachine(projectId, userId);
    expect(result).not.toBeNull();
    expect(result!.machineId).toBe(machineId);
    expect(result!.machineUrl).toBe("http://localhost:9998");
    expect(result!.machineName).toBe("test-machine");
    expect(result!.localRepoPath).toBe("/home/test/repos/pm-proj");
  });

  test("getProjectMemberMachine returns null for non-member", async () => {
    const result = await getProjectMemberMachine(projectId, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  test("removeProjectMember deletes and returns true", async () => {
    const removed = await removeProjectMember(projectId, userId);
    expect(removed).toBe(true);
  });

  test("removeProjectMember returns false for non-existent member", async () => {
    const removed = await removeProjectMember(projectId, userId);
    expect(removed).toBe(false);
  });

  test("getProjectMembers returns empty after removal", async () => {
    const members = await getProjectMembers(projectId);
    const found = members.find((m) => m.userId === userId);
    expect(found).toBeUndefined();
  });
});

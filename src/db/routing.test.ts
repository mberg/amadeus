// ABOUTME: Tests for database-driven webhook routing.
// ABOUTME: Validates project lookup by name/team key, assignee matching, and fallback routing.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import { resolveRoute } from "./routing";

const TEST_ORG = "test-org-route";
let userId: string;
let machineId: string;
let projectId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-route', 'Test') ON CONFLICT DO NOTHING`;
  const [userRow] = await sql`INSERT INTO users (org_id, name, email, auth_method, linear_user_id) VALUES ('test-org-route', 'Matt', 'matt@test.com', 'api_key', 'lin-matt-123') RETURNING id`;
  userId = userRow.id;
  const [machineRow] = await sql`INSERT INTO machines (org_id, name, url, api_key_hash) VALUES ('test-org-route', 'claudius', 'http://claudius:8080', 'hashroute') RETURNING id`;
  machineId = machineRow.id;
  const [projectRow] = await sql`INSERT INTO projects (org_id, name, linear_team_key, linear_project_name) VALUES ('test-org-route', 'Zebra', 'ZEB', 'Zebra') RETURNING id`;
  projectId = projectRow.id;
  await sql`INSERT INTO machine_projects (machine_id, project_id, local_repo_path) VALUES (${machineId}, ${projectId}, '/home/matt/repos/zebra')`;
  await sql`INSERT INTO project_members (project_id, user_id, machine_id) VALUES (${projectId}, ${userId}, ${machineId})`;
});

afterAll(async () => {
  await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
  await sql`DELETE FROM machine_projects WHERE project_id = ${projectId}`;
  await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
  await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
});

describe("resolveRoute", () => {
  test("routes by Linear project name + assignee", async () => {
    const result = await resolveRoute(TEST_ORG, {
      linearProjectName: "Zebra",
      assigneeLinearId: "lin-matt-123",
    });
    expect(result).not.toBeNull();
    expect(result!.machineUrl).toBe("http://claudius:8080");
    expect(result!.machineName).toBe("claudius");
    expect(result!.localRepoPath).toBe("/home/matt/repos/zebra");
    expect(result!.projectId).toBe(projectId);
    expect(result!.reason).toContain("assigned user");
  });

  test("routes by team key when project name not provided", async () => {
    const result = await resolveRoute(TEST_ORG, {
      teamKey: "ZEB",
      assigneeLinearId: "lin-matt-123",
    });
    expect(result).not.toBeNull();
    expect(result!.machineUrl).toBe("http://claudius:8080");
    expect(result!.machineName).toBe("claudius");
    expect(result!.localRepoPath).toBe("/home/matt/repos/zebra");
    expect(result!.projectId).toBe(projectId);
  });

  test("falls back to any machine when assignee not found", async () => {
    const result = await resolveRoute(TEST_ORG, {
      linearProjectName: "Zebra",
      assigneeLinearId: "lin-unknown-999",
    });
    expect(result).not.toBeNull();
    expect(result!.machineUrl).toBe("http://claudius:8080");
    expect(result!.reason).toContain("fallback");
  });

  test("returns null for unknown project", async () => {
    const result = await resolveRoute(TEST_ORG, {
      linearProjectName: "NonExistent",
    });
    expect(result).toBeNull();
  });

  test("returns null for unknown org", async () => {
    const result = await resolveRoute("no-such-org", {
      linearProjectName: "Zebra",
    });
    expect(result).toBeNull();
  });
});

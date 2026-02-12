// ABOUTME: Tests for projects table CRUD operations.
// ABOUTME: Validates create, read, lookup, and delete for multi-tenant project records.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate } from "./index";
import {
  createProject,
  getProject,
  getProjectsByOrg,
  getProjectByLinearKey,
  getProjectByLinearName,
  getProjectsByRealm,
  deleteProject,
} from "./projects";
import { createRealm } from "./realms";

const TEST_ORG = "test-org-proj";

beforeAll(async () => {
  await migrate();
  await sql`
    INSERT INTO organizations (org_id)
    VALUES (${TEST_ORG})
    ON CONFLICT (org_id) DO NOTHING
  `;
});

afterAll(async () => {
  await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
});

describe("projects CRUD", () => {
  test("createProject inserts and returns a project", async () => {
    const project = await createProject({
      orgId: TEST_ORG,
      name: "My Project",
      linearProjectUrl: "https://linear.app/team/proj-1",
      githubRepoUrl: "https://github.com/org/repo",
      linearTeamKey: "TEAM",
      linearProjectName: "Sprint Alpha",
    });

    expect(project.id).toBeDefined();
    expect(project.orgId).toBe(TEST_ORG);
    expect(project.name).toBe("My Project");
    expect(project.linearProjectUrl).toBe("https://linear.app/team/proj-1");
    expect(project.githubRepoUrl).toBe("https://github.com/org/repo");
    expect(project.linearTeamKey).toBe("TEAM");
    expect(project.linearProjectName).toBe("Sprint Alpha");
    expect(project.createdAt).toBeInstanceOf(Date);
  });

  test("createProject works with only required fields", async () => {
    const project = await createProject({
      orgId: TEST_ORG,
      name: "Minimal Project",
    });

    expect(project.id).toBeDefined();
    expect(project.orgId).toBe(TEST_ORG);
    expect(project.name).toBe("Minimal Project");
    expect(project.linearProjectUrl).toBeNull();
    expect(project.githubRepoUrl).toBeNull();
    expect(project.linearTeamKey).toBeNull();
    expect(project.linearProjectName).toBeNull();
  });

  test("getProject returns a project by id", async () => {
    const created = await createProject({
      orgId: TEST_ORG,
      name: "Fetch Me",
    });

    const fetched = await getProject(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe("Fetch Me");
  });

  test("getProject returns null for unknown id", async () => {
    const result = await getProject("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  test("getProjectsByOrg returns all projects in org ordered by created_at", async () => {
    // Clean slate for ordering test
    await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;

    const first = await createProject({ orgId: TEST_ORG, name: "First" });
    const second = await createProject({ orgId: TEST_ORG, name: "Second" });

    const projects = await getProjectsByOrg(TEST_ORG);
    expect(projects.length).toBe(2);
    expect(projects[0].name).toBe("First");
    expect(projects[1].name).toBe("Second");
  });

  test("getProjectsByOrg returns empty array for unknown org", async () => {
    const projects = await getProjectsByOrg("nonexistent-org");
    expect(projects).toEqual([]);
  });

  test("getProjectByLinearKey finds project by org and team key", async () => {
    await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;

    await createProject({
      orgId: TEST_ORG,
      name: "Linear Keyed",
      linearTeamKey: "LK-1",
    });

    const found = await getProjectByLinearKey(TEST_ORG, "LK-1");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Linear Keyed");
    expect(found!.linearTeamKey).toBe("LK-1");
  });

  test("getProjectByLinearKey returns null when not found", async () => {
    const result = await getProjectByLinearKey(TEST_ORG, "NOPE");
    expect(result).toBeNull();
  });

  test("getProjectByLinearName finds project case-insensitively", async () => {
    await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;

    await createProject({
      orgId: TEST_ORG,
      name: "Named Project",
      linearProjectName: "Sprint Beta",
    });

    const lower = await getProjectByLinearName(TEST_ORG, "sprint beta");
    expect(lower).not.toBeNull();
    expect(lower!.linearProjectName).toBe("Sprint Beta");

    const upper = await getProjectByLinearName(TEST_ORG, "SPRINT BETA");
    expect(upper).not.toBeNull();
    expect(upper!.linearProjectName).toBe("Sprint Beta");

    const mixed = await getProjectByLinearName(TEST_ORG, "Sprint Beta");
    expect(mixed).not.toBeNull();
    expect(mixed!.linearProjectName).toBe("Sprint Beta");
  });

  test("getProjectByLinearName returns null when not found", async () => {
    const result = await getProjectByLinearName(TEST_ORG, "No Such Project");
    expect(result).toBeNull();
  });

  test("deleteProject removes project and returns true", async () => {
    const project = await createProject({
      orgId: TEST_ORG,
      name: "Delete Me",
    });

    const deleted = await deleteProject(project.id, TEST_ORG);
    expect(deleted).toBe(true);

    const after = await getProject(project.id);
    expect(after).toBeNull();
  });

  test("deleteProject returns false for nonexistent project", async () => {
    const result = await deleteProject(
      "00000000-0000-0000-0000-000000000000",
      TEST_ORG
    );
    expect(result).toBe(false);
  });

  test("deleteProject returns false when org_id does not match", async () => {
    const project = await createProject({
      orgId: TEST_ORG,
      name: "Wrong Org Delete",
    });

    const result = await deleteProject(project.id, "wrong-org");
    expect(result).toBe(false);

    // Should still exist
    const still = await getProject(project.id);
    expect(still).not.toBeNull();
  });

  test("createProject with realmId links project to realm", async () => {
    await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;

    const realm = await createRealm({
      orgId: TEST_ORG,
      name: "realm-for-project",
      linearWorkspace: "ws-proj",
    });

    const project = await createProject({
      orgId: TEST_ORG,
      name: "Realm Project",
      realmId: realm.id,
    });

    expect(project.realmId).toBe(realm.id);

    const fetched = await getProject(project.id);
    expect(fetched!.realmId).toBe(realm.id);
  });

  test("createProject without realmId has null realmId", async () => {
    const project = await createProject({
      orgId: TEST_ORG,
      name: "No Realm Project",
    });

    expect(project.realmId).toBeNull();
  });

  test("getProjectsByRealm returns projects for a specific realm", async () => {
    await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;

    const realmA = await createRealm({ orgId: TEST_ORG, name: "realm-a", linearWorkspace: "ws-a" });
    const realmB = await createRealm({ orgId: TEST_ORG, name: "realm-b", linearWorkspace: "ws-b" });

    await createProject({ orgId: TEST_ORG, name: "Proj A1", realmId: realmA.id });
    await createProject({ orgId: TEST_ORG, name: "Proj A2", realmId: realmA.id });
    await createProject({ orgId: TEST_ORG, name: "Proj B1", realmId: realmB.id });
    await createProject({ orgId: TEST_ORG, name: "No Realm" });

    const projectsA = await getProjectsByRealm(realmA.id);
    expect(projectsA.length).toBe(2);
    expect(projectsA.map((p) => p.name).sort()).toEqual(["Proj A1", "Proj A2"]);

    const projectsB = await getProjectsByRealm(realmB.id);
    expect(projectsB.length).toBe(1);
    expect(projectsB[0].name).toBe("Proj B1");
  });
});

// ABOUTME: Tests for hub API handler functions.
// ABOUTME: Validates HTTP semantics (status codes, validation, JSON responses) against real Postgres.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "bun";
import { migrate, setSecret } from "../db/index";
import { createRealm } from "../db/realms";
import {
  handleGetUsers,
  handleCreateUser,
  handleDeleteUser,
  handleGetProjects,
  handleCreateProject,
  handleDeleteProject,
  handleGetMachines,
  handleGetMachineProjects,
  handleAddMachineProject,
  handleRemoveMachineProject,
  handleGetMachineAccess,
  handleAddMachineAccess,
  handleRemoveMachineAccess,
  handleGetProjectMembers,
  handleAddProjectMember,
  handleRemoveProjectMember,
  handleGetUserLinearPats,
  handleDeleteUserLinearPat,
} from "./api";

const TEST_ORG = "test-org-hub-api";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("hub api", () => {
  beforeAll(async () => {
    await migrate();
    await sql`
      INSERT INTO organizations (org_id)
      VALUES (${TEST_ORG})
      ON CONFLICT (org_id) DO NOTHING
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM project_members WHERE project_id IN (SELECT id FROM projects WHERE org_id = ${TEST_ORG})`;
    await sql`DELETE FROM machine_access WHERE machine_id IN (SELECT id FROM machines WHERE org_id = ${TEST_ORG})`;
    await sql`DELETE FROM machine_projects WHERE machine_id IN (SELECT id FROM machines WHERE org_id = ${TEST_ORG})`;
    await sql`DELETE FROM org_members WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM users WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM projects WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM machines WHERE org_id = ${TEST_ORG}`;
    await sql`DELETE FROM organizations WHERE org_id = ${TEST_ORG}`;
  });

  // --- Users ---

  test("handleGetUsers returns empty array for new org", async () => {
    const res = await handleGetUsers(TEST_ORG);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("handleCreateUser creates user and returns 201", async () => {
    const req = jsonRequest({ name: "Alice", email: "alice@hub-api.test" });
    const res = await handleCreateUser(req, TEST_ORG);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Alice");
    expect(body.email).toBe("alice@hub-api.test");
    expect(body.orgId).toBe(TEST_ORG);
    expect(body.id).toBeDefined();
  });

  test("handleCreateUser returns 400 for missing name", async () => {
    const req = jsonRequest({ email: "noname@hub-api.test" });
    const res = await handleCreateUser(req, TEST_ORG);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("handleCreateUser returns 400 for missing email", async () => {
    const req = jsonRequest({ name: "NoEmail" });
    const res = await handleCreateUser(req, TEST_ORG);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("handleGetUsers returns created users", async () => {
    const res = await handleGetUsers(TEST_ORG);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].orgId).toBe(TEST_ORG);
  });

  test("handleDeleteUser removes user and returns 204", async () => {
    const createRes = await handleCreateUser(
      jsonRequest({ name: "ToDelete", email: "delete@hub-api.test" }),
      TEST_ORG
    );
    const { id } = await createRes.json();

    const res = await handleDeleteUser(TEST_ORG, id);
    expect(res.status).toBe(204);
  });

  test("handleDeleteUser returns 404 for nonexistent user", async () => {
    const res = await handleDeleteUser(TEST_ORG, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  // --- Projects ---

  test("handleGetProjects returns empty array for new org", async () => {
    const res = await handleGetProjects(TEST_ORG);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("handleCreateProject creates and returns 201", async () => {
    const req = jsonRequest({ name: "Test Project", githubRepoUrl: "https://github.com/test/repo" });
    const res = await handleCreateProject(req, TEST_ORG);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Project");
    expect(body.orgId).toBe(TEST_ORG);
    expect(body.githubRepoUrl).toBe("https://github.com/test/repo");
  });

  test("handleCreateProject returns 400 for missing name", async () => {
    const req = jsonRequest({ githubRepoUrl: "https://github.com/test/repo" });
    const res = await handleCreateProject(req, TEST_ORG);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("handleGetProjects returns created projects", async () => {
    const res = await handleGetProjects(TEST_ORG);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("handleDeleteProject removes project and returns 204", async () => {
    const createRes = await handleCreateProject(
      jsonRequest({ name: "ToDeleteProject" }),
      TEST_ORG
    );
    const { id } = await createRes.json();

    const res = await handleDeleteProject(TEST_ORG, id);
    expect(res.status).toBe(204);
  });

  test("handleDeleteProject returns 404 for nonexistent project", async () => {
    const res = await handleDeleteProject(TEST_ORG, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  // --- Machines ---

  test("handleGetMachines returns empty array for new org", async () => {
    const res = await handleGetMachines(TEST_ORG);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  // --- Machine Projects ---

  describe("machine projects", () => {
    let machineId: string;
    let projectId: string;

    beforeAll(async () => {
      // Create a machine and project for linking tests
      const [machine] = await sql`
        INSERT INTO machines (org_id, name, url, api_key_hash)
        VALUES (${TEST_ORG}, 'test-machine', 'http://localhost:9999', 'hash-test')
        RETURNING id
      `;
      machineId = machine.id;

      const createRes = await handleCreateProject(
        jsonRequest({ name: "LinkProject" }),
        TEST_ORG
      );
      const proj = await createRes.json();
      projectId = proj.id;
    });

    test("handleGetMachineProjects returns empty array", async () => {
      const res = await handleGetMachineProjects(machineId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    test("handleAddMachineProject links machine to project", async () => {
      const req = jsonRequest({ projectId, localRepoPath: "/home/test/repo" });
      const res = await handleAddMachineProject(req, machineId);
      expect(res.status).toBe(204);
    });

    test("handleGetMachineProjects returns linked project", async () => {
      const res = await handleGetMachineProjects(machineId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].projectId).toBe(projectId);
      expect(body[0].localRepoPath).toBe("/home/test/repo");
    });

    test("handleAddMachineProject returns 400 for missing fields", async () => {
      const res = await handleAddMachineProject(jsonRequest({ projectId }), machineId);
      expect(res.status).toBe(400);
    });

    test("handleRemoveMachineProject removes link", async () => {
      const res = await handleRemoveMachineProject(machineId, projectId);
      expect(res.status).toBe(204);
    });

    test("handleRemoveMachineProject returns 404 for nonexistent link", async () => {
      const res = await handleRemoveMachineProject(machineId, "00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    // --- Machine Access ---

    let userId: string;

    test("handleGetMachineAccess returns empty array", async () => {
      const res = await handleGetMachineAccess(machineId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    test("handleAddMachineAccess grants access", async () => {
      const userRes = await handleCreateUser(
        jsonRequest({ name: "MachineUser", email: "machineuser@hub-api.test" }),
        TEST_ORG
      );
      const user = await userRes.json();
      userId = user.id;

      const res = await handleAddMachineAccess(jsonRequest({ userId }), machineId);
      expect(res.status).toBe(204);
    });

    test("handleGetMachineAccess returns granted access", async () => {
      const res = await handleGetMachineAccess(machineId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].userId).toBe(userId);
    });

    test("handleAddMachineAccess returns 400 for missing userId", async () => {
      const res = await handleAddMachineAccess(jsonRequest({}), machineId);
      expect(res.status).toBe(400);
    });

    test("handleRemoveMachineAccess removes access", async () => {
      const res = await handleRemoveMachineAccess(machineId, userId);
      expect(res.status).toBe(204);
    });

    test("handleRemoveMachineAccess returns 404 for nonexistent access", async () => {
      const res = await handleRemoveMachineAccess(machineId, "00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });

    // --- Project Members ---

    test("handleGetProjectMembers returns empty array", async () => {
      const res = await handleGetProjectMembers(projectId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    test("handleAddProjectMember assigns user to project", async () => {
      const req = jsonRequest({ userId, machineId });
      const res = await handleAddProjectMember(req, projectId);
      expect(res.status).toBe(204);
    });

    test("handleAddProjectMember auto-creates machine_projects entry", async () => {
      const res = await handleGetMachineProjects(machineId);
      expect(res.status).toBe(200);
      const body = await res.json();
      const link = body.find((p: { projectId: string }) => p.projectId === projectId);
      expect(link).toBeDefined();
      expect(link.localRepoPath).toBe("");
    });

    test("handleGetProjectMembers returns assigned member", async () => {
      const res = await handleGetProjectMembers(projectId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.length).toBe(1);
      expect(body[0].userId).toBe(userId);
      expect(body[0].machineId).toBe(machineId);
    });

    test("handleAddProjectMember returns 400 for missing fields", async () => {
      const res = await handleAddProjectMember(jsonRequest({ userId }), projectId);
      expect(res.status).toBe(400);
    });

    test("handleRemoveProjectMember removes member", async () => {
      const res = await handleRemoveProjectMember(projectId, userId);
      expect(res.status).toBe(204);
    });

    test("handleRemoveProjectMember returns 404 for nonexistent member", async () => {
      const res = await handleRemoveProjectMember(projectId, "00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(404);
    });
  });

  // --- User Linear PATs ---

  describe("user linear pats", () => {
    let patUserId: string;
    let realmId1: string;
    let realmId2: string;

    beforeAll(async () => {
      const createRes = await handleCreateUser(
        jsonRequest({ name: "PatUser", email: "patuser@hub-api.test" }),
        TEST_ORG
      );
      const user = await createRes.json();
      patUserId = user.id;

      const realm1 = await createRealm({ orgId: TEST_ORG, name: "realm-a", linearWorkspace: "ws-a" });
      realmId1 = realm1.id;
      const realm2 = await createRealm({ orgId: TEST_ORG, name: "realm-b", linearWorkspace: "ws-b" });
      realmId2 = realm2.id;

      await setSecret(TEST_ORG, `user:${patUserId}:realm:${realmId1}:linear_pat`, "pat-1");
      await setSecret(TEST_ORG, `user:${patUserId}:realm:${realmId2}:linear_pat`, "pat-2");
      await setSecret(TEST_ORG, `user:${patUserId}:linear_pat`, "global-pat");
    });

    afterAll(async () => {
      await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG} AND key_name LIKE ${"user:" + patUserId + ":%"}`;
      await sql`DELETE FROM secrets WHERE org_id = ${TEST_ORG} AND key_name = ${"user:" + patUserId + ":linear_pat"}`;
      await sql`DELETE FROM realms WHERE org_id = ${TEST_ORG}`;
    });

    test("handleGetUserLinearPats returns all PATs for user", async () => {
      const res = await handleGetUserLinearPats(TEST_ORG, patUserId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(3);

      const realmIds = body.map((p: { realmId: string | null }) => p.realmId);
      expect(realmIds).toContain(realmId1);
      expect(realmIds).toContain(realmId2);
      expect(realmIds).toContain(null);

      for (const pat of body) {
        expect(pat.hasToken).toBe(true);
      }
    });

    test("handleGetUserLinearPats returns empty array for user with no PATs", async () => {
      const res = await handleGetUserLinearPats(TEST_ORG, "00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    test("handleDeleteUserLinearPat removes realm-specific PAT", async () => {
      const req = new Request("http://localhost/test", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realmId: realmId2 }),
      });
      const res = await handleDeleteUserLinearPat(req, TEST_ORG, patUserId);
      expect(res.status).toBe(204);

      // Verify it's gone
      const listRes = await handleGetUserLinearPats(TEST_ORG, patUserId);
      const body = await listRes.json();
      const realmIds = body.map((p: { realmId: string | null }) => p.realmId);
      expect(realmIds).not.toContain(realmId2);
    });

    test("handleDeleteUserLinearPat removes global PAT", async () => {
      const req = new Request("http://localhost/test", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await handleDeleteUserLinearPat(req, TEST_ORG, patUserId);
      expect(res.status).toBe(204);

      const listRes = await handleGetUserLinearPats(TEST_ORG, patUserId);
      const body = await listRes.json();
      const realmIds = body.map((p: { realmId: string | null }) => p.realmId);
      expect(realmIds).not.toContain(null);
    });

    test("handleDeleteUserLinearPat returns 404 for nonexistent PAT", async () => {
      const req = new Request("http://localhost/test", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realmId: "nonexistent-realm" }),
      });
      const res = await handleDeleteUserLinearPat(req, TEST_ORG, patUserId);
      expect(res.status).toBe(404);
    });
  });
});

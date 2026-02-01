# Hub Data Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace YAML-driven config/realm routing with a relational data model (users, machines, projects) managed through the hub database.

**Architecture:** New Postgres tables for users, org_members, projects, machine_projects, project_members, and machine_access. Extend existing machines and organizations tables. New DB access functions. New router that queries DB instead of YAML config. Machine config slimmed to name + token + hubUrl.

**Tech Stack:** Bun, Postgres (Bun.sql), Zod, bun:test

---

### Task 1: Schema Migration — New Tables

Add the new tables to the Postgres schema. This is the foundation everything else builds on.

**Files:**
- Modify: `src/db/schema.sql`

**Step 1: Add new tables to schema.sql**

Add after the existing `machines` table (line 19) and before `secrets` (line 21). Also alter the existing `organizations` and `machines` tables.

```sql
-- After existing tables, add:

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_user_id UUID;

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          TEXT REFERENCES organizations(org_id),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  linear_user_id  TEXT,
  auth_method     TEXT NOT NULL DEFAULT 'api_key',
  api_key_hash    TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users (org_id);
CREATE INDEX IF NOT EXISTS idx_users_linear_id ON users (linear_user_id);

CREATE TABLE IF NOT EXISTS org_members (
  org_id   TEXT NOT NULL REFERENCES organizations(org_id),
  user_id  UUID NOT NULL REFERENCES users(id),
  role     TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (org_id, user_id)
);

ALTER TABLE machines ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);
ALTER TABLE machines ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'public';
ALTER TABLE machines ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unknown';

CREATE TABLE IF NOT EXISTS machine_access (
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (machine_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               TEXT NOT NULL REFERENCES organizations(org_id),
  name                 TEXT NOT NULL,
  linear_project_url   TEXT,
  github_repo_url      TEXT,
  linear_team_key      TEXT,
  linear_project_name  TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (org_id);
CREATE INDEX IF NOT EXISTS idx_projects_linear ON projects (org_id, linear_team_key);

CREATE TABLE IF NOT EXISTS machine_projects (
  machine_id      UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  local_repo_path TEXT NOT NULL,
  PRIMARY KEY (machine_id, project_id)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
```

**Step 2: Run migration to verify SQL is valid**

Run: `bun run src/db/migrate-check.ts` (or connect to a test DB and run the schema)

Verify: No SQL errors. All tables created with correct constraints.

**Step 3: Commit**

```bash
git add src/db/schema.sql
git commit -m "add schema for users, projects, machine_access, org_members, project_members"
```

---

### Task 2: DB Access Layer — Users

Add CRUD functions for the users table.

**Files:**
- Create: `src/db/users.ts`
- Create: `src/db/users.test.ts`

**Step 1: Write failing tests**

```typescript
// src/db/users.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate } from "./index";
import {
  createUser,
  getUser,
  getUserByLinearId,
  getUsersByOrg,
  updateUserLinearId,
  deleteUser,
  type DbUser,
} from "./users";
import { sql } from "bun";

beforeAll(async () => {
  await migrate();
  // Ensure test org exists
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org', 'Test Org') ON CONFLICT DO NOTHING`;
});

afterAll(async () => {
  await sql`DELETE FROM users WHERE org_id = 'test-org'`;
  await sql.close();
});

describe("users", () => {
  let userId: string;

  test("createUser creates a user", async () => {
    const user = await createUser({
      orgId: "test-org",
      name: "Matt",
      email: "matt@example.com",
      authMethod: "api_key",
    });
    userId = user.id;
    expect(user.name).toBe("Matt");
    expect(user.email).toBe("matt@example.com");
    expect(user.orgId).toBe("test-org");
    expect(user.authMethod).toBe("api_key");
    expect(user.linearUserId).toBeNull();
  });

  test("getUser returns user by id", async () => {
    const user = await getUser(userId);
    expect(user).not.toBeNull();
    expect(user!.name).toBe("Matt");
  });

  test("getUsersByOrg returns users in org", async () => {
    const users = await getUsersByOrg("test-org");
    expect(users.length).toBeGreaterThanOrEqual(1);
    expect(users.some(u => u.id === userId)).toBe(true);
  });

  test("updateUserLinearId updates the linear user id", async () => {
    await updateUserLinearId(userId, "lin-user-123");
    const user = await getUser(userId);
    expect(user!.linearUserId).toBe("lin-user-123");
  });

  test("getUserByLinearId finds user by linear id", async () => {
    const user = await getUserByLinearId("test-org", "lin-user-123");
    expect(user).not.toBeNull();
    expect(user!.id).toBe(userId);
  });

  test("deleteUser removes user", async () => {
    const deleted = await deleteUser(userId);
    expect(deleted).toBe(true);
    const user = await getUser(userId);
    expect(user).toBeNull();
  });
});
```

**Step 2: Run tests to confirm they fail**

Run: `bun test src/db/users.test.ts`
Expected: FAIL — module `./users` not found

**Step 3: Implement users.ts**

```typescript
// src/db/users.ts
// ABOUTME: Postgres CRUD operations for the users table.
// ABOUTME: Users are org-scoped and linked to Linear via linear_user_id.

import { sql } from "bun";

export interface DbUser {
  id: string;
  orgId: string | null;
  name: string;
  email: string;
  linearUserId: string | null;
  authMethod: string;
  apiKeyHash: string | null;
  createdAt: Date;
}

interface CreateUserParams {
  orgId: string | null;
  name: string;
  email: string;
  authMethod: string;
  apiKeyHash?: string;
}

function rowToUser(row: Record<string, unknown>): DbUser {
  return {
    id: row.id as string,
    orgId: (row.org_id as string) ?? null,
    name: row.name as string,
    email: row.email as string,
    linearUserId: (row.linear_user_id as string) ?? null,
    authMethod: row.auth_method as string,
    apiKeyHash: (row.api_key_hash as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export async function createUser(params: CreateUserParams): Promise<DbUser> {
  const [row] = await sql`
    INSERT INTO users (org_id, name, email, auth_method, api_key_hash)
    VALUES (${params.orgId}, ${params.name}, ${params.email}, ${params.authMethod}, ${params.apiKeyHash ?? null})
    RETURNING *
  `;
  return rowToUser(row);
}

export async function getUser(id: string): Promise<DbUser | null> {
  const [row] = await sql`SELECT * FROM users WHERE id = ${id}`;
  return row ? rowToUser(row) : null;
}

export async function getUserByLinearId(orgId: string, linearUserId: string): Promise<DbUser | null> {
  const [row] = await sql`
    SELECT * FROM users WHERE org_id = ${orgId} AND linear_user_id = ${linearUserId}
  `;
  return row ? rowToUser(row) : null;
}

export async function getUsersByOrg(orgId: string): Promise<DbUser[]> {
  const rows = await sql`SELECT * FROM users WHERE org_id = ${orgId} ORDER BY created_at`;
  return rows.map(rowToUser);
}

export async function updateUserLinearId(id: string, linearUserId: string): Promise<void> {
  await sql`UPDATE users SET linear_user_id = ${linearUserId} WHERE id = ${id}`;
}

export async function deleteUser(id: string): Promise<boolean> {
  const result = await sql`DELETE FROM users WHERE id = ${id}`;
  return result.count > 0;
}
```

**Step 4: Run tests to confirm they pass**

Run: `bun test src/db/users.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/db/users.ts src/db/users.test.ts
git commit -m "add users table CRUD operations with tests"
```

---

### Task 3: DB Access Layer — Org Members

**Files:**
- Create: `src/db/org-members.ts`
- Create: `src/db/org-members.test.ts`

**Step 1: Write failing tests**

```typescript
// src/db/org-members.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate } from "./index";
import { createUser } from "./users";
import { addOrgMember, getOrgMembers, removeOrgMember, getOrgMemberRole } from "./org-members";
import { sql } from "bun";

let userId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-members', 'Test') ON CONFLICT DO NOTHING`;
  const user = await createUser({ orgId: "test-org-members", name: "Test", email: "t@t.com", authMethod: "api_key" });
  userId = user.id;
});

afterAll(async () => {
  await sql`DELETE FROM org_members WHERE org_id = 'test-org-members'`;
  await sql`DELETE FROM users WHERE org_id = 'test-org-members'`;
  await sql.close();
});

describe("org_members", () => {
  test("addOrgMember adds a member", async () => {
    await addOrgMember("test-org-members", userId, "owner");
    const members = await getOrgMembers("test-org-members");
    expect(members.length).toBe(1);
    expect(members[0].userId).toBe(userId);
    expect(members[0].role).toBe("owner");
  });

  test("getOrgMemberRole returns role", async () => {
    const role = await getOrgMemberRole("test-org-members", userId);
    expect(role).toBe("owner");
  });

  test("removeOrgMember removes member", async () => {
    const removed = await removeOrgMember("test-org-members", userId);
    expect(removed).toBe(true);
    const members = await getOrgMembers("test-org-members");
    expect(members.length).toBe(0);
  });
});
```

**Step 2: Run tests to confirm they fail**

Run: `bun test src/db/org-members.test.ts`
Expected: FAIL — module not found

**Step 3: Implement org-members.ts**

```typescript
// src/db/org-members.ts
// ABOUTME: Postgres operations for org membership.
// ABOUTME: Maps users to organizations with roles (owner/member).

import { sql } from "bun";

export interface OrgMember {
  orgId: string;
  userId: string;
  role: string;
}

export async function addOrgMember(orgId: string, userId: string, role: string = "member"): Promise<void> {
  await sql`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${orgId}, ${userId}, ${role})
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = ${role}
  `;
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const rows = await sql`
    SELECT org_id, user_id, role FROM org_members WHERE org_id = ${orgId}
  `;
  return rows.map(r => ({ orgId: r.org_id as string, userId: r.user_id as string, role: r.role as string }));
}

export async function getOrgMemberRole(orgId: string, userId: string): Promise<string | null> {
  const [row] = await sql`
    SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  return (row?.role as string) ?? null;
}

export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  const result = await sql`DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}`;
  return result.count > 0;
}
```

**Step 4: Run tests, confirm pass**

Run: `bun test src/db/org-members.test.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/db/org-members.ts src/db/org-members.test.ts
git commit -m "add org_members CRUD operations with tests"
```

---

### Task 4: DB Access Layer — Projects

**Files:**
- Create: `src/db/projects.ts`
- Create: `src/db/projects.test.ts`

**Step 1: Write failing tests**

```typescript
// src/db/projects.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate } from "./index";
import {
  createProject,
  getProject,
  getProjectsByOrg,
  getProjectByLinearKey,
  getProjectByLinearName,
  deleteProject,
} from "./projects";
import { sql } from "bun";

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-proj', 'Test') ON CONFLICT DO NOTHING`;
});

afterAll(async () => {
  await sql`DELETE FROM projects WHERE org_id = 'test-org-proj'`;
  await sql.close();
});

describe("projects", () => {
  let projectId: string;

  test("createProject creates a project", async () => {
    const project = await createProject({
      orgId: "test-org-proj",
      name: "Zebra",
      linearTeamKey: "ZEB",
      linearProjectName: "Zebra",
      githubRepoUrl: "https://github.com/org/zebra",
    });
    projectId = project.id;
    expect(project.name).toBe("Zebra");
    expect(project.linearTeamKey).toBe("ZEB");
  });

  test("getProject returns project by id", async () => {
    const project = await getProject(projectId);
    expect(project).not.toBeNull();
    expect(project!.name).toBe("Zebra");
  });

  test("getProjectsByOrg returns projects in org", async () => {
    const projects = await getProjectsByOrg("test-org-proj");
    expect(projects.length).toBeGreaterThanOrEqual(1);
  });

  test("getProjectByLinearKey finds by team key", async () => {
    const project = await getProjectByLinearKey("test-org-proj", "ZEB");
    expect(project).not.toBeNull();
    expect(project!.id).toBe(projectId);
  });

  test("getProjectByLinearName finds by project name (case-insensitive)", async () => {
    const project = await getProjectByLinearName("test-org-proj", "zebra");
    expect(project).not.toBeNull();
    expect(project!.id).toBe(projectId);
  });

  test("deleteProject removes project", async () => {
    const deleted = await deleteProject(projectId, "test-org-proj");
    expect(deleted).toBe(true);
    const project = await getProject(projectId);
    expect(project).toBeNull();
  });
});
```

**Step 2: Run tests to confirm fail**

Run: `bun test src/db/projects.test.ts`
Expected: FAIL — module not found

**Step 3: Implement projects.ts**

```typescript
// src/db/projects.ts
// ABOUTME: Postgres CRUD operations for the projects table.
// ABOUTME: Projects link to Linear/GitHub and are used for webhook routing.

import { sql } from "bun";

export interface DbProject {
  id: string;
  orgId: string;
  name: string;
  linearProjectUrl: string | null;
  githubRepoUrl: string | null;
  linearTeamKey: string | null;
  linearProjectName: string | null;
  createdAt: Date;
}

interface CreateProjectParams {
  orgId: string;
  name: string;
  linearProjectUrl?: string;
  githubRepoUrl?: string;
  linearTeamKey?: string;
  linearProjectName?: string;
}

function rowToProject(row: Record<string, unknown>): DbProject {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    linearProjectUrl: (row.linear_project_url as string) ?? null,
    githubRepoUrl: (row.github_repo_url as string) ?? null,
    linearTeamKey: (row.linear_team_key as string) ?? null,
    linearProjectName: (row.linear_project_name as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

export async function createProject(params: CreateProjectParams): Promise<DbProject> {
  const [row] = await sql`
    INSERT INTO projects (org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name)
    VALUES (
      ${params.orgId}, ${params.name}, ${params.linearProjectUrl ?? null},
      ${params.githubRepoUrl ?? null}, ${params.linearTeamKey ?? null}, ${params.linearProjectName ?? null}
    )
    RETURNING *
  `;
  return rowToProject(row);
}

export async function getProject(id: string): Promise<DbProject | null> {
  const [row] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  return row ? rowToProject(row) : null;
}

export async function getProjectsByOrg(orgId: string): Promise<DbProject[]> {
  const rows = await sql`SELECT * FROM projects WHERE org_id = ${orgId} ORDER BY created_at`;
  return rows.map(rowToProject);
}

export async function getProjectByLinearKey(orgId: string, teamKey: string): Promise<DbProject | null> {
  const [row] = await sql`
    SELECT * FROM projects WHERE org_id = ${orgId} AND linear_team_key = ${teamKey}
  `;
  return row ? rowToProject(row) : null;
}

export async function getProjectByLinearName(orgId: string, projectName: string): Promise<DbProject | null> {
  const [row] = await sql`
    SELECT * FROM projects WHERE org_id = ${orgId} AND LOWER(linear_project_name) = LOWER(${projectName})
  `;
  return row ? rowToProject(row) : null;
}

export async function deleteProject(id: string, orgId: string): Promise<boolean> {
  const result = await sql`DELETE FROM projects WHERE id = ${id} AND org_id = ${orgId}`;
  return result.count > 0;
}
```

**Step 4: Run tests, confirm pass**

Run: `bun test src/db/projects.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/db/projects.ts src/db/projects.test.ts
git commit -m "add projects table CRUD operations with tests"
```

---

### Task 5: DB Access Layer — Machine Projects & Machine Access

**Files:**
- Create: `src/db/machine-projects.ts`
- Create: `src/db/machine-projects.test.ts`

**Step 1: Write failing tests**

```typescript
// src/db/machine-projects.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate, createMachine } from "./index";
import { createProject } from "./projects";
import { createUser } from "./users";
import {
  addMachineProject,
  getMachineProjects,
  removeMachineProject,
  addMachineAccess,
  getMachineAccessList,
  removeMachineAccess,
  getMachinesForProject,
} from "./machine-projects";
import { sql } from "bun";

let machineId: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-mp', 'Test') ON CONFLICT DO NOTHING`;

  const user = await createUser({ orgId: "test-org-mp", name: "Test", email: "t@t.com", authMethod: "api_key" });
  userId = user.id;

  const machine = await createMachine("test-org-mp", "test-machine", "http://localhost:9999", "hash123");
  machineId = machine.id;

  const project = await createProject({ orgId: "test-org-mp", name: "TestProj", linearTeamKey: "TP" });
  projectId = project.id;
});

afterAll(async () => {
  await sql`DELETE FROM machine_access WHERE machine_id = ${machineId}`;
  await sql`DELETE FROM machine_projects WHERE machine_id = ${machineId}`;
  await sql`DELETE FROM projects WHERE org_id = 'test-org-mp'`;
  await sql`DELETE FROM machines WHERE org_id = 'test-org-mp'`;
  await sql`DELETE FROM users WHERE org_id = 'test-org-mp'`;
  await sql.close();
});

describe("machine_projects", () => {
  test("addMachineProject links machine to project", async () => {
    await addMachineProject(machineId, projectId, "/home/test/repos/proj");
    const projects = await getMachineProjects(machineId);
    expect(projects.length).toBe(1);
    expect(projects[0].projectId).toBe(projectId);
    expect(projects[0].localRepoPath).toBe("/home/test/repos/proj");
  });

  test("getMachinesForProject returns machines with paths", async () => {
    const machines = await getMachinesForProject(projectId);
    expect(machines.length).toBe(1);
    expect(machines[0].machineId).toBe(machineId);
    expect(machines[0].localRepoPath).toBe("/home/test/repos/proj");
  });

  test("removeMachineProject unlinks", async () => {
    const removed = await removeMachineProject(machineId, projectId);
    expect(removed).toBe(true);
    const projects = await getMachineProjects(machineId);
    expect(projects.length).toBe(0);
  });
});

describe("machine_access", () => {
  test("addMachineAccess grants access", async () => {
    await addMachineAccess(machineId, userId);
    const access = await getMachineAccessList(machineId);
    expect(access.length).toBe(1);
    expect(access[0].userId).toBe(userId);
  });

  test("removeMachineAccess revokes access", async () => {
    const removed = await removeMachineAccess(machineId, userId);
    expect(removed).toBe(true);
    const access = await getMachineAccessList(machineId);
    expect(access.length).toBe(0);
  });
});
```

**Step 2: Run tests to confirm fail**

Run: `bun test src/db/machine-projects.test.ts`
Expected: FAIL — module not found

**Step 3: Implement machine-projects.ts**

```typescript
// src/db/machine-projects.ts
// ABOUTME: Postgres operations for machine-project mappings and machine access control.
// ABOUTME: Links machines to projects with local repo paths, and controls user access.

import { sql } from "bun";

export interface MachineProject {
  machineId: string;
  projectId: string;
  localRepoPath: string;
}

export interface MachineAccessEntry {
  machineId: string;
  userId: string;
}

// --- Machine Projects ---

export async function addMachineProject(machineId: string, projectId: string, localRepoPath: string): Promise<void> {
  await sql`
    INSERT INTO machine_projects (machine_id, project_id, local_repo_path)
    VALUES (${machineId}, ${projectId}, ${localRepoPath})
    ON CONFLICT (machine_id, project_id) DO UPDATE SET local_repo_path = ${localRepoPath}
  `;
}

export async function getMachineProjects(machineId: string): Promise<MachineProject[]> {
  const rows = await sql`
    SELECT machine_id, project_id, local_repo_path FROM machine_projects WHERE machine_id = ${machineId}
  `;
  return rows.map(r => ({
    machineId: r.machine_id as string,
    projectId: r.project_id as string,
    localRepoPath: r.local_repo_path as string,
  }));
}

export async function getMachinesForProject(projectId: string): Promise<Array<MachineProject & { machineUrl: string; machineName: string }>> {
  const rows = await sql`
    SELECT mp.machine_id, mp.project_id, mp.local_repo_path, m.url, m.name
    FROM machine_projects mp
    JOIN machines m ON m.id = mp.machine_id
    WHERE mp.project_id = ${projectId}
  `;
  return rows.map(r => ({
    machineId: r.machine_id as string,
    projectId: r.project_id as string,
    localRepoPath: r.local_repo_path as string,
    machineUrl: r.url as string,
    machineName: r.name as string,
  }));
}

export async function removeMachineProject(machineId: string, projectId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM machine_projects WHERE machine_id = ${machineId} AND project_id = ${projectId}
  `;
  return result.count > 0;
}

// --- Machine Access ---

export async function addMachineAccess(machineId: string, userId: string): Promise<void> {
  await sql`
    INSERT INTO machine_access (machine_id, user_id)
    VALUES (${machineId}, ${userId})
    ON CONFLICT DO NOTHING
  `;
}

export async function getMachineAccessList(machineId: string): Promise<MachineAccessEntry[]> {
  const rows = await sql`
    SELECT machine_id, user_id FROM machine_access WHERE machine_id = ${machineId}
  `;
  return rows.map(r => ({
    machineId: r.machine_id as string,
    userId: r.user_id as string,
  }));
}

export async function removeMachineAccess(machineId: string, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM machine_access WHERE machine_id = ${machineId} AND user_id = ${userId}
  `;
  return result.count > 0;
}
```

**Step 4: Run tests, confirm pass**

Run: `bun test src/db/machine-projects.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/db/machine-projects.ts src/db/machine-projects.test.ts
git commit -m "add machine_projects and machine_access CRUD with tests"
```

---

### Task 6: DB Access Layer — Project Members

**Files:**
- Create: `src/db/project-members.ts`
- Create: `src/db/project-members.test.ts`

**Step 1: Write failing tests**

```typescript
// src/db/project-members.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate, createMachine } from "./index";
import { createProject } from "./projects";
import { createUser } from "./users";
import { addProjectMember, getProjectMembers, getProjectMemberMachine, removeProjectMember } from "./project-members";
import { sql } from "bun";

let machineId: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-pm', 'Test') ON CONFLICT DO NOTHING`;
  const user = await createUser({ orgId: "test-org-pm", name: "Test", email: "t@t.com", authMethod: "api_key" });
  userId = user.id;
  const machine = await createMachine("test-org-pm", "test-machine", "http://localhost:9998", "hash456");
  machineId = machine.id;
  const project = await createProject({ orgId: "test-org-pm", name: "PM-Proj", linearTeamKey: "PM" });
  projectId = project.id;
});

afterAll(async () => {
  await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
  await sql`DELETE FROM projects WHERE org_id = 'test-org-pm'`;
  await sql`DELETE FROM machines WHERE org_id = 'test-org-pm'`;
  await sql`DELETE FROM users WHERE org_id = 'test-org-pm'`;
  await sql.close();
});

describe("project_members", () => {
  test("addProjectMember assigns user to project on machine", async () => {
    await addProjectMember(projectId, userId, machineId);
    const members = await getProjectMembers(projectId);
    expect(members.length).toBe(1);
    expect(members[0].userId).toBe(userId);
    expect(members[0].machineId).toBe(machineId);
  });

  test("getProjectMemberMachine returns machine for user+project", async () => {
    const result = await getProjectMemberMachine(projectId, userId);
    expect(result).not.toBeNull();
    expect(result!.machineId).toBe(machineId);
  });

  test("removeProjectMember removes assignment", async () => {
    const removed = await removeProjectMember(projectId, userId);
    expect(removed).toBe(true);
    const result = await getProjectMemberMachine(projectId, userId);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to confirm fail**

Run: `bun test src/db/project-members.test.ts`
Expected: FAIL — module not found

**Step 3: Implement project-members.ts**

```typescript
// src/db/project-members.ts
// ABOUTME: Postgres operations for project member assignments.
// ABOUTME: Maps users to projects on specific machines for webhook routing.

import { sql } from "bun";

export interface ProjectMember {
  projectId: string;
  userId: string;
  machineId: string;
}

export async function addProjectMember(projectId: string, userId: string, machineId: string): Promise<void> {
  await sql`
    INSERT INTO project_members (project_id, user_id, machine_id)
    VALUES (${projectId}, ${userId}, ${machineId})
    ON CONFLICT (project_id, user_id) DO UPDATE SET machine_id = ${machineId}
  `;
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await sql`
    SELECT project_id, user_id, machine_id FROM project_members WHERE project_id = ${projectId}
  `;
  return rows.map(r => ({
    projectId: r.project_id as string,
    userId: r.user_id as string,
    machineId: r.machine_id as string,
  }));
}

export async function getProjectMemberMachine(
  projectId: string,
  userId: string
): Promise<{ machineId: string; machineUrl: string; machineName: string; localRepoPath: string } | null> {
  const [row] = await sql`
    SELECT pm.machine_id, m.url, m.name, mp.local_repo_path
    FROM project_members pm
    JOIN machines m ON m.id = pm.machine_id
    JOIN machine_projects mp ON mp.machine_id = pm.machine_id AND mp.project_id = pm.project_id
    WHERE pm.project_id = ${projectId} AND pm.user_id = ${userId}
  `;
  if (!row) return null;
  return {
    machineId: row.machine_id as string,
    machineUrl: row.url as string,
    machineName: row.name as string,
    localRepoPath: row.local_repo_path as string,
  };
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const result = await sql`DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}`;
  return result.count > 0;
}
```

**Step 4: Run tests, confirm pass**

Run: `bun test src/db/project-members.test.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/db/project-members.ts src/db/project-members.test.ts
git commit -m "add project_members CRUD with tests"
```

---

### Task 7: Update DB Index Exports

Re-export the new modules from the DB index so other code can import from `"./db"`.

**Files:**
- Modify: `src/db/index.ts`

**Step 1: Add re-exports to src/db/index.ts**

Add at the end of the file (after line 200):

```typescript
// Re-export entity modules
export * from "./users";
export * from "./org-members";
export * from "./projects";
export * from "./machine-projects";
export * from "./project-members";
```

**Step 2: Verify all existing tests still pass**

Run: `bun test src/db/`
Expected: All tests PASS (existing + new)

**Step 3: Commit**

```bash
git add src/db/index.ts
git commit -m "re-export new entity modules from db index"
```

---

### Task 8: Extend Machines Table — Update Existing DB Functions

The existing `machines` table and `createMachine()` function need updating for the new columns (owner_user_id, permission, status).

**Files:**
- Modify: `src/db/index.ts` (the `DbMachine` interface and related functions)
- Create: `src/db/machines.test.ts`

**Step 1: Write failing tests for new machine fields**

```typescript
// src/db/machines.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate, createMachine, getMachines, authenticateMachine } from "./index";
import { createUser } from "./users";
import { getMachineWithPermission, updateMachinePermission, updateMachineOwner } from "./machines";
import { sql } from "bun";

let userId: string;
let machineId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-mach', 'Test') ON CONFLICT DO NOTHING`;
  const user = await createUser({ orgId: "test-org-mach", name: "Test", email: "t@t.com", authMethod: "api_key" });
  userId = user.id;
});

afterAll(async () => {
  await sql`DELETE FROM machines WHERE org_id = 'test-org-mach'`;
  await sql`DELETE FROM users WHERE org_id = 'test-org-mach'`;
  await sql.close();
});

describe("machines extended", () => {
  test("createMachine still works with existing interface", async () => {
    const machine = await createMachine("test-org-mach", "claudius", "http://localhost:7777", "hash789");
    machineId = machine.id;
    expect(machine.name).toBe("claudius");
  });

  test("updateMachineOwner sets owner", async () => {
    await updateMachineOwner(machineId, userId);
    const machine = await getMachineWithPermission(machineId);
    expect(machine).not.toBeNull();
    expect(machine!.ownerUserId).toBe(userId);
  });

  test("updateMachinePermission changes permission", async () => {
    await updateMachinePermission(machineId, "allowed");
    const machine = await getMachineWithPermission(machineId);
    expect(machine!.permission).toBe("allowed");
  });
});
```

**Step 2: Run tests to confirm fail**

Run: `bun test src/db/machines.test.ts`
Expected: FAIL — functions not found

**Step 3: Create machines.ts with extended functions**

```typescript
// src/db/machines.ts
// ABOUTME: Extended machine operations for the hub data model.
// ABOUTME: Adds owner, permission, and status management to machines.

import { sql } from "bun";

export interface DbMachineExtended {
  id: string;
  orgId: string;
  name: string;
  url: string;
  apiKeyHash: string;
  ownerUserId: string | null;
  permission: string;
  status: string;
  createdAt: Date;
  lastSeen: Date | null;
}

function rowToMachineExtended(row: Record<string, unknown>): DbMachineExtended {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    url: row.url as string,
    apiKeyHash: row.api_key_hash as string,
    ownerUserId: (row.owner_user_id as string) ?? null,
    permission: (row.permission as string) ?? "public",
    status: (row.status as string) ?? "unknown",
    createdAt: new Date(row.created_at as string),
    lastSeen: row.last_seen ? new Date(row.last_seen as string) : null,
  };
}

export async function getMachineWithPermission(id: string): Promise<DbMachineExtended | null> {
  const [row] = await sql`SELECT * FROM machines WHERE id = ${id}`;
  return row ? rowToMachineExtended(row) : null;
}

export async function updateMachineOwner(id: string, ownerUserId: string): Promise<void> {
  await sql`UPDATE machines SET owner_user_id = ${ownerUserId} WHERE id = ${id}`;
}

export async function updateMachinePermission(id: string, permission: string): Promise<void> {
  await sql`UPDATE machines SET permission = ${permission} WHERE id = ${id}`;
}

export async function updateMachineStatus(id: string, status: string): Promise<void> {
  await sql`UPDATE machines SET status = ${status}, last_seen = now() WHERE id = ${id}`;
}
```

**Step 4: Run tests, confirm pass**

Run: `bun test src/db/machines.test.ts`
Expected: All 3 tests PASS

**Step 5: Add export to db/index.ts and commit**

Add to the re-exports in `src/db/index.ts`:

```typescript
export * from "./machines";
```

```bash
git add src/db/machines.ts src/db/machines.test.ts src/db/index.ts
git commit -m "add extended machine operations for owner and permission"
```

---

### Task 9: DB Routing Query — The Core Routing Function

This is the key function that replaces YAML-based routing. Given a webhook payload, it queries the DB to find which machine + repo path to route to.

**Files:**
- Create: `src/db/routing.ts`
- Create: `src/db/routing.test.ts`

**Step 1: Write failing tests**

```typescript
// src/db/routing.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { migrate, createMachine } from "./index";
import { createProject } from "./projects";
import { createUser } from "./users";
import { addMachineProject } from "./machine-projects";
import { addProjectMember } from "./project-members";
import { resolveRoute } from "./routing";
import { sql } from "bun";

let userId: string;
let machineId: string;
let projectId: string;

beforeAll(async () => {
  await migrate();
  await sql`INSERT INTO organizations (org_id, name) VALUES ('test-org-route', 'Test') ON CONFLICT DO NOTHING`;

  const user = await createUser({
    orgId: "test-org-route",
    name: "Matt",
    email: "matt@test.com",
    authMethod: "api_key",
  });
  userId = user.id;
  await sql`UPDATE users SET linear_user_id = 'lin-matt-123' WHERE id = ${userId}`;

  const machine = await createMachine("test-org-route", "claudius", "http://claudius:8080", "hashroute");
  machineId = machine.id;

  const project = await createProject({
    orgId: "test-org-route",
    name: "Zebra",
    linearTeamKey: "ZEB",
    linearProjectName: "Zebra",
  });
  projectId = project.id;

  await addMachineProject(machineId, projectId, "/home/matt/repos/zebra");
  await addProjectMember(projectId, userId, machineId);
});

afterAll(async () => {
  await sql`DELETE FROM project_members WHERE project_id = ${projectId}`;
  await sql`DELETE FROM machine_projects WHERE machine_id = ${machineId}`;
  await sql`DELETE FROM projects WHERE org_id = 'test-org-route'`;
  await sql`DELETE FROM machines WHERE org_id = 'test-org-route'`;
  await sql`DELETE FROM users WHERE org_id = 'test-org-route'`;
  await sql.close();
});

describe("resolveRoute", () => {
  test("routes by Linear project name + assignee", async () => {
    const result = await resolveRoute("test-org-route", {
      linearProjectName: "Zebra",
      teamKey: "ZEB",
      assigneeLinearId: "lin-matt-123",
    });
    expect(result).not.toBeNull();
    expect(result!.machineUrl).toBe("http://claudius:8080");
    expect(result!.localRepoPath).toBe("/home/matt/repos/zebra");
    expect(result!.machineName).toBe("claudius");
  });

  test("routes by team key when project name not provided", async () => {
    const result = await resolveRoute("test-org-route", {
      teamKey: "ZEB",
      assigneeLinearId: "lin-matt-123",
    });
    expect(result).not.toBeNull();
    expect(result!.machineUrl).toBe("http://claudius:8080");
  });

  test("falls back to any machine when assignee not found", async () => {
    const result = await resolveRoute("test-org-route", {
      linearProjectName: "Zebra",
      teamKey: "ZEB",
      assigneeLinearId: "unknown-user",
    });
    // Should still find a machine (fallback)
    expect(result).not.toBeNull();
    expect(result!.machineUrl).toBe("http://claudius:8080");
    expect(result!.reason).toContain("fallback");
  });

  test("returns null for unknown project", async () => {
    const result = await resolveRoute("test-org-route", {
      linearProjectName: "NonExistent",
      teamKey: "NOPE",
    });
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to confirm fail**

Run: `bun test src/db/routing.test.ts`
Expected: FAIL — module not found

**Step 3: Implement routing.ts**

```typescript
// src/db/routing.ts
// ABOUTME: Database-driven webhook routing for hub mode.
// ABOUTME: Resolves Linear webhook payloads to machine + repo path via DB queries.

import { sql } from "bun";

export interface RouteQuery {
  linearProjectName?: string;
  teamKey?: string;
  assigneeLinearId?: string;
}

export interface ResolvedRoute {
  machineUrl: string;
  machineName: string;
  localRepoPath: string;
  projectId: string;
  reason: string;
}

export async function resolveRoute(orgId: string, query: RouteQuery): Promise<ResolvedRoute | null> {
  // Step 1: Find the project by Linear project name or team key
  let projectRow: Record<string, unknown> | undefined;

  if (query.linearProjectName) {
    [projectRow] = await sql`
      SELECT id, name FROM projects
      WHERE org_id = ${orgId} AND LOWER(linear_project_name) = LOWER(${query.linearProjectName})
    `;
  }

  if (!projectRow && query.teamKey) {
    [projectRow] = await sql`
      SELECT id, name FROM projects
      WHERE org_id = ${orgId} AND linear_team_key = ${query.teamKey}
    `;
  }

  if (!projectRow) return null;

  const projectId = projectRow.id as string;
  const projectName = projectRow.name as string;

  // Step 2: If we have an assignee, try to find their specific machine
  if (query.assigneeLinearId) {
    const [userRow] = await sql`
      SELECT id FROM users WHERE org_id = ${orgId} AND linear_user_id = ${query.assigneeLinearId}
    `;

    if (userRow) {
      const userId = userRow.id as string;
      const [memberRow] = await sql`
        SELECT pm.machine_id, m.url, m.name, mp.local_repo_path
        FROM project_members pm
        JOIN machines m ON m.id = pm.machine_id
        JOIN machine_projects mp ON mp.machine_id = pm.machine_id AND mp.project_id = pm.project_id
        WHERE pm.project_id = ${projectId} AND pm.user_id = ${userId}
      `;

      if (memberRow) {
        return {
          machineUrl: memberRow.url as string,
          machineName: memberRow.name as string,
          localRepoPath: memberRow.local_repo_path as string,
          projectId,
          reason: `Matched project "${projectName}" for assigned user`,
        };
      }
    }
  }

  // Step 3: Fallback — pick any machine that has this project mapped
  const [fallbackRow] = await sql`
    SELECT mp.machine_id, m.url, m.name, mp.local_repo_path
    FROM machine_projects mp
    JOIN machines m ON m.id = mp.machine_id
    WHERE mp.project_id = ${projectId}
    LIMIT 1
  `;

  if (fallbackRow) {
    return {
      machineUrl: fallbackRow.url as string,
      machineName: fallbackRow.name as string,
      localRepoPath: fallbackRow.local_repo_path as string,
      projectId,
      reason: `Matched project "${projectName}" (fallback — no user-specific machine)`,
    };
  }

  return null;
}
```

**Step 4: Run tests, confirm pass**

Run: `bun test src/db/routing.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/db/routing.ts src/db/routing.test.ts
git commit -m "add database-driven webhook routing with tests"
```

---

### Task 10: Rewrite Hub Router to Use DB

Replace the YAML-based `routeWebhook()` in `src/hub/router.ts` to call the new `resolveRoute()` DB function. Keep the payload extraction helpers (`getTeamKeyFromPayload`, `getProjectNameFromPayload`) — they're still needed.

**Files:**
- Modify: `src/hub/router.ts`
- Modify: `src/hub/router.test.ts`

**Step 1: Update router.test.ts with tests for the new DB-based routing**

Keep existing payload extraction tests. Add new test for the DB-based `routeWebhook()`.

Add to `src/hub/router.test.ts`:

```typescript
// Add a new describe block for routeWebhook with DB
import { routeWebhook } from "./router";

describe("routeWebhook (DB-based)", () => {
  // Note: These tests will need a running Postgres with seeded data.
  // For now, test that it handles the no-config case gracefully.
  test("returns no-route when project not found in DB", async () => {
    const payload: LinearWebhookPayload = {
      action: "update",
      type: "Issue",
      data: {
        id: "123",
        identifier: "NOPE-456",
        title: "Unknown project",
        assignee: { id: "user-1" },
      },
    };
    const result = await routeWebhook("nonexistent-org", payload);
    expect(result.machineUrl).toBeNull();
  });
});
```

**Step 2: Rewrite routeWebhook in router.ts**

```typescript
// src/hub/router.ts — rewritten routeWebhook
// Keep getTeamKeyFromPayload and getProjectNameFromPayload unchanged.
// Replace routeWebhook:

import { resolveRoute } from "../db/routing";

function getAssigneeIdFromPayload(payload: LinearWebhookPayload): string | null {
  const { type, data } = payload;
  if (type === "Issue" && !isComment(data)) {
    return data.assignee?.id ?? null;
  } else if (type === "Comment" && isComment(data)) {
    return data.issue?.assignee?.id ?? null;
  }
  return null;
}

export async function routeWebhook(orgId: string, payload: LinearWebhookPayload): Promise<RouteResult> {
  const teamKey = getTeamKeyFromPayload(payload);
  const projectName = getProjectNameFromPayload(payload);
  const assigneeLinearId = getAssigneeIdFromPayload(payload);

  const route = await resolveRoute(orgId, {
    linearProjectName: projectName ?? undefined,
    teamKey: teamKey ?? undefined,
    assigneeLinearId: assigneeLinearId ?? undefined,
  });

  if (route) {
    return {
      machineUrl: route.machineUrl,
      machineName: route.machineName,
      localRepoPath: route.localRepoPath,
      reason: route.reason,
    };
  }

  return { machineUrl: null, machineName: null, localRepoPath: null, reason: "No matching project in database" };
}
```

Note: `RouteResult` needs a new `localRepoPath` field:

```typescript
export interface RouteResult {
  machineUrl: string | null;
  machineName: string | null;
  localRepoPath: string | null;
  reason: string;
}
```

**Step 3: Remove the REALM_CONFIG import from router.ts**

The router no longer depends on `REALM_CONFIG`. Remove:
```typescript
import { REALM_CONFIG } from "../shared/config";
```

**Step 4: Run all router tests**

Run: `bun test src/hub/router.test.ts`
Expected: All tests PASS (extraction tests unchanged, new DB test passes)

**Step 5: Commit**

```bash
git add src/hub/router.ts src/hub/router.test.ts
git commit -m "rewrite hub router to use database routing instead of YAML config"
```

---

### Task 11: Update Webhook Handler to Pass orgId and localRepoPath

The webhook handler in `create-server.ts` calls `routeWebhook()`. Update it to:
1. Pass `orgId` to the new async `routeWebhook()`
2. Include `localRepoPath` when forwarding to machines

**Files:**
- Modify: `src/create-server.ts`

**Step 1: Find and update the routeWebhook call site**

In `create-server.ts`, find where `routeWebhook(payload)` is called (hub mode webhook handling). Change to:

```typescript
const routeResult = await routeWebhook(orgId, payload);
```

**Step 2: Include localRepoPath in the forwarded request**

When forwarding the webhook to a machine, include `localRepoPath` in the request body or as a header so the machine knows which repo to use:

```typescript
// When forwarding to machine, add localRepoPath to the payload
const forwardBody = JSON.stringify({
  ...payload,
  _routing: {
    localRepoPath: routeResult.localRepoPath,
  },
});
```

**Step 3: Run existing create-server tests**

Run: `bun test src/create-server.test.ts`
Expected: Tests pass (may need minor updates for the async routeWebhook)

**Step 4: Commit**

```bash
git add src/create-server.ts
git commit -m "update webhook handler to use DB-based routing with repo path"
```

---

### Task 12: Update Machine to Use Hub-Provided Repo Path

When a machine receives a forwarded webhook, it should use the `_routing.localRepoPath` from the payload instead of looking up paths from local config.

**Files:**
- Modify: `src/create-server.ts` (machine mode webhook handling)

**Step 1: Extract _routing from incoming payload on machine side**

In the machine's webhook handling code, check for `_routing.localRepoPath`:

```typescript
const routing = payload._routing;
const projectPath = routing?.localRepoPath ?? getProjectPathFromConfig(teamKey, projectName);
```

This provides backward compatibility: if no routing info is provided (standalone mode), fall back to config-based paths.

**Step 2: Run tests**

Run: `bun test src/create-server.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/create-server.ts
git commit -m "machine uses hub-provided repo path from forwarded webhooks"
```

---

### Task 13: Slim Machine Config Schema

Add a new minimal machine config schema for machines that only need name + token + hubUrl.

**Files:**
- Modify: `src/config-schema.ts`

**Step 1: Add token field to MachineConfigSchema**

In `src/config-schema.ts`, update `MachineConfigSchema` (line 69-73):

```typescript
export const MachineConfigSchema = z.object({
  name: z.string().min(1, "Machine name cannot be empty"),
  token: z.string().optional(),
  hubUrl: z.string().url().optional(),
  heartbeat: z.boolean().default(false),
});
```

**Step 2: Run config schema tests**

Run: `bun test src/config-schema.test.ts`
Expected: PASS (new field is optional, so existing configs still valid)

**Step 3: Commit**

```bash
git add src/config-schema.ts
git commit -m "add token field to machine config schema"
```

---

### Task 14: Update Heartbeat to Authenticate with Token

The machine heartbeat currently sends an API key hash. Update it to also support token-based auth (SHA256 of the token from config).

**Files:**
- Modify: `src/hub-heartbeat.ts`

**Step 1: Read the token from machine config and hash it**

In `hub-heartbeat.ts`, when building the heartbeat request, compute the auth header from the token:

```typescript
import { getMachineConfig } from "./config";

// In the heartbeat sender:
const machineConfig = getMachineConfig();
const token = machineConfig.token;
if (token) {
  const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
  headers["X-Machine-Token-Hash"] = hash;
}
```

**Step 2: Update hub heartbeat endpoint to validate token hash**

In `create-server.ts`, the `/hub/heartbeat` handler should accept `X-Machine-Token-Hash` as an alternative to the existing API key authentication.

**Step 3: Run tests**

Run: `bun test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/hub-heartbeat.ts src/create-server.ts
git commit -m "support token-based machine authentication in heartbeats"
```

---

### Task 15: Linear PAT Storage and User ID Fetch

When a user stores their Linear PAT, fetch their Linear user ID and store it.

**Files:**
- Create: `src/linear-identity.ts`
- Create: `src/linear-identity.test.ts`

**Step 1: Write failing test**

```typescript
// src/linear-identity.test.ts
import { describe, test, expect } from "bun:test";
import { fetchLinearUserId } from "./linear-identity";

describe("fetchLinearUserId", () => {
  test("returns null for invalid token", async () => {
    const result = await fetchLinearUserId("invalid-token-xxx");
    expect(result).toBeNull();
  });

  // Integration test — skip in CI, run manually with real token
  // test("fetches real user id", async () => {
  //   const result = await fetchLinearUserId(process.env.LINEAR_API_KEY!);
  //   expect(result).toBeTruthy();
  // });
});
```

**Step 2: Run test to confirm fail**

Run: `bun test src/linear-identity.test.ts`
Expected: FAIL — module not found

**Step 3: Implement linear-identity.ts**

```typescript
// src/linear-identity.ts
// ABOUTME: Fetches the authenticated user's ID from Linear using their PAT.
// ABOUTME: Used to link Amadeus users to their Linear identity for routing.

export async function fetchLinearUserId(apiKey: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: "{ viewer { id } }",
      }),
    });

    if (!response.ok) return null;

    const json = await response.json() as { data?: { viewer?: { id: string } } };
    return json.data?.viewer?.id ?? null;
  } catch {
    return null;
  }
}
```

**Step 4: Run test, confirm pass**

Run: `bun test src/linear-identity.test.ts`
Expected: PASS (invalid token returns null)

**Step 5: Commit**

```bash
git add src/linear-identity.ts src/linear-identity.test.ts
git commit -m "add Linear identity fetch for user PAT linkage"
```

---

### Task 16: Hub API Endpoints for Entity Management

Add REST endpoints to the hub for managing users, projects, machines, and their relationships. These will be called by the dashboard UI.

**Files:**
- Create: `src/hub/api.ts`
- Modify: `src/create-server.ts` (mount new routes)

**Step 1: Create hub/api.ts with entity management handlers**

```typescript
// src/hub/api.ts
// ABOUTME: REST API handlers for managing hub entities (users, projects, machines).
// ABOUTME: Called by the dashboard UI for CRUD operations.

import { createUser, getUser, getUsersByOrg, updateUserLinearId, deleteUser } from "../db/users";
import { createProject, getProjectsByOrg, deleteProject } from "../db/projects";
import { addMachineProject, getMachineProjects, removeMachineProject } from "../db/machine-projects";
import { addProjectMember, getProjectMembers, removeProjectMember } from "../db/project-members";
import { addMachineAccess, getMachineAccessList, removeMachineAccess } from "../db/machine-projects";
import { addOrgMember, getOrgMembers, removeOrgMember } from "../db/org-members";
import { fetchLinearUserId } from "../linear-identity";
import { setSecret, getSecret } from "../db";

// Each handler takes (req, orgId) and returns a Response.
// Wire these into create-server.ts routes.

export async function handleGetUsers(orgId: string): Promise<Response> {
  const users = await getUsersByOrg(orgId);
  return Response.json(users);
}

export async function handleCreateUser(req: Request, orgId: string): Promise<Response> {
  const body = await req.json() as { name: string; email: string };
  const user = await createUser({ orgId, name: body.name, email: body.email, authMethod: "api_key" });
  await addOrgMember(orgId, user.id, "member");
  return Response.json(user, { status: 201 });
}

export async function handleSetUserLinearPat(req: Request, orgId: string, userId: string): Promise<Response> {
  const body = await req.json() as { pat: string };

  // Fetch Linear user ID
  const linearUserId = await fetchLinearUserId(body.pat);
  if (!linearUserId) {
    return Response.json({ error: "Invalid Linear API key" }, { status: 400 });
  }

  // Store encrypted PAT
  await setSecret(orgId, `user:${userId}:linear_pat`, body.pat);
  // Update user with Linear ID
  await updateUserLinearId(userId, linearUserId);

  return Response.json({ linearUserId });
}

export async function handleGetProjects(orgId: string): Promise<Response> {
  const projects = await getProjectsByOrg(orgId);
  return Response.json(projects);
}

export async function handleCreateProject(req: Request, orgId: string): Promise<Response> {
  const body = await req.json();
  const { createProject: cp } = await import("../db/projects");
  const project = await cp({ orgId, ...body });
  return Response.json(project, { status: 201 });
}

// ... similar handlers for machine-projects, project-members, machine-access
```

This is a large file — implement only the handlers needed for the current UI work. The pattern is consistent: parse request, call DB function, return JSON response.

**Step 2: Mount routes in create-server.ts**

Add a section for `/hub/api/*` routes that call these handlers. All require admin auth.

**Step 3: Run tests**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/hub/api.ts src/create-server.ts
git commit -m "add hub API endpoints for entity management"
```

---

### Task 17: Run Full Test Suite and Fix Breakage

After all the above changes, run the full test suite and fix any breakage.

**Files:**
- Various (depends on failures)

**Step 1: Run full test suite**

Run: `bun test`

**Step 2: Fix any failures**

Common expected issues:
- `routeWebhook` signature changed from sync to async — update callers
- `RouteResult` has new `localRepoPath` field — update any code that destructures it
- Import paths for moved/new modules

**Step 3: Commit fixes**

```bash
git add -A  # after reviewing what changed
git commit -m "fix test breakage from data model migration"
```

---

## Task Dependency Order

```
Task 1  (schema)
  ↓
Tasks 2-6  (DB access layers — can be done in parallel)
  ↓
Task 7  (re-exports)
  ↓
Task 8  (extend machines)
  ↓
Task 9  (routing query)
  ↓
Task 10 (rewrite router)
  ↓
Task 11 (update webhook handler)
  ↓
Task 12 (machine uses hub path)
  ↓
Task 13 (slim machine config)
  ↓
Task 14 (token heartbeat)
  ↓
Task 15 (Linear PAT fetch)
  ↓
Task 16 (API endpoints)
  ↓
Task 17 (full test suite)
```

Tasks 2-6 are independent of each other and can be done in parallel.
Tasks 10-17 are sequential as each builds on the previous.

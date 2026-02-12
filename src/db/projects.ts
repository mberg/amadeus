// ABOUTME: CRUD operations for the projects table in Postgres.
// ABOUTME: Projects track a Linear project + GitHub repo pair, scoped by org_id.

import { sql } from "bun";

export interface DbProject {
  id: string;
  orgId: string;
  name: string;
  linearProjectUrl: string | null;
  githubRepoUrl: string | null;
  linearTeamKey: string | null;
  linearProjectName: string | null;
  realmId: string | null;
  createdAt: Date;
}

export interface CreateProjectParams {
  orgId: string;
  name: string;
  linearProjectUrl?: string;
  githubRepoUrl?: string;
  linearTeamKey?: string;
  linearProjectName?: string;
  realmId?: string;
}

export async function createProject(params: CreateProjectParams): Promise<DbProject> {
  const [row] = await sql`
    INSERT INTO projects (org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id)
    VALUES (
      ${params.orgId},
      ${params.name},
      ${params.linearProjectUrl ?? null},
      ${params.githubRepoUrl ?? null},
      ${params.linearTeamKey ?? null},
      ${params.linearProjectName ?? null},
      ${params.realmId ?? null}
    )
    RETURNING id, org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id, created_at
  `;
  return rowToProject(row);
}

export async function getProject(id: string): Promise<DbProject | null> {
  const [row] = await sql`
    SELECT id, org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id, created_at
    FROM projects WHERE id = ${id}
  `;
  return row ? rowToProject(row) : null;
}

export async function getProjectsByOrg(orgId: string): Promise<DbProject[]> {
  const rows = await sql`
    SELECT id, org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id, created_at
    FROM projects WHERE org_id = ${orgId}
    ORDER BY created_at
  `;
  return rows.map(rowToProject);
}

export async function getProjectByLinearKey(orgId: string, teamKey: string): Promise<DbProject | null> {
  const [row] = await sql`
    SELECT id, org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id, created_at
    FROM projects WHERE org_id = ${orgId} AND linear_team_key = ${teamKey}
  `;
  return row ? rowToProject(row) : null;
}

export async function getProjectByLinearName(orgId: string, projectName: string): Promise<DbProject | null> {
  const [row] = await sql`
    SELECT id, org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id, created_at
    FROM projects WHERE org_id = ${orgId} AND LOWER(linear_project_name) = LOWER(${projectName})
  `;
  return row ? rowToProject(row) : null;
}

export async function getProjectsByRealm(realmId: string): Promise<DbProject[]> {
  const rows = await sql`
    SELECT id, org_id, name, linear_project_url, github_repo_url, linear_team_key, linear_project_name, realm_id, created_at
    FROM projects WHERE realm_id = ${realmId}
    ORDER BY created_at
  `;
  return rows.map(rowToProject);
}

export async function deleteProject(id: string, orgId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM projects WHERE id = ${id} AND org_id = ${orgId}
  `;
  return result.count > 0;
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
    realmId: (row.realm_id as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

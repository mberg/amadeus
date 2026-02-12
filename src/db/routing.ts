// ABOUTME: Database-driven webhook routing that replaces YAML-based config.
// ABOUTME: Resolves a webhook's project + assignee to a target machine and repo path.

import { sql } from "bun";

export interface RouteQuery {
  linearProjectName?: string;
  teamKey?: string;
  assigneeLinearId?: string;
}

export interface ResolvedRoute {
  machineId: string;
  machineUrl: string;
  machineName: string;
  localRepoPath: string;
  projectId: string;
  reason: string;
}

export async function resolveRoute(
  orgId: string,
  query: RouteQuery
): Promise<ResolvedRoute | null> {
  // Step 1: Find the project — try linear_project_name first, then linear_team_key
  let project: { id: string; name: string } | undefined;

  if (query.linearProjectName) {
    const [row] = await sql`
      SELECT id, name FROM projects
      WHERE org_id = ${orgId} AND LOWER(linear_project_name) = LOWER(${query.linearProjectName})
    `;
    if (row) project = { id: row.id, name: row.name };
  }

  if (!project && query.teamKey) {
    const [row] = await sql`
      SELECT id, name FROM projects
      WHERE org_id = ${orgId} AND UPPER(linear_team_key) = UPPER(${query.teamKey})
    `;
    if (row) project = { id: row.id, name: row.name };
  }

  if (!project) return null;

  // Step 2: If assignee provided, try to find their specific machine assignment
  if (query.assigneeLinearId) {
    const [row] = await sql`
      SELECT m.id AS machine_id, m.url, m.name AS machine_name, mp.local_repo_path
      FROM users u
      JOIN project_members pm ON pm.user_id = u.id
      JOIN machines m ON m.id = pm.machine_id
      JOIN machine_projects mp ON mp.machine_id = pm.machine_id AND mp.project_id = pm.project_id
      WHERE u.org_id = ${orgId}
        AND u.linear_user_id = ${query.assigneeLinearId}
        AND pm.project_id = ${project.id}
    `;
    if (row) {
      return {
        machineId: row.machine_id,
        machineUrl: row.url,
        machineName: row.machine_name,
        localRepoPath: row.local_repo_path,
        projectId: project.id,
        reason: `Matched project "${project.name}" for assigned user`,
      };
    }
  }

  // Step 3: Fallback — any machine that has this project mapped
  const [row] = await sql`
    SELECT m.id AS machine_id, m.url, m.name AS machine_name, mp.local_repo_path
    FROM machine_projects mp
    JOIN machines m ON m.id = mp.machine_id
    WHERE mp.project_id = ${project.id}
    LIMIT 1
  `;
  if (row) {
    return {
      machineId: row.machine_id,
      machineUrl: row.url,
      machineName: row.machine_name,
      localRepoPath: row.local_repo_path,
      projectId: project.id,
      reason: `Matched project "${project.name}" (fallback — no user-specific machine)`,
    };
  }

  return null;
}

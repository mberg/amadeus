// ABOUTME: CRUD operations for the project_members table.
// ABOUTME: Manages user-to-project assignments with machine routing.

import { sql } from "bun";

export interface ProjectMember {
  projectId: string;
  userId: string;
  machineId: string;
}

export interface ProjectMemberMachine {
  machineId: string;
  machineUrl: string;
  machineName: string;
  localRepoPath: string;
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  machineId: string
): Promise<ProjectMember> {
  const [row] = await sql`
    INSERT INTO project_members (project_id, user_id, machine_id)
    VALUES (${projectId}, ${userId}, ${machineId})
    ON CONFLICT (project_id, user_id) DO UPDATE SET machine_id = ${machineId}
    RETURNING project_id, user_id, machine_id
  `;
  return { projectId: row.project_id, userId: row.user_id, machineId: row.machine_id };
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await sql`
    SELECT project_id, user_id, machine_id FROM project_members WHERE project_id = ${projectId}
  `;
  return rows.map((row) => ({
    projectId: row.project_id,
    userId: row.user_id,
    machineId: row.machine_id,
  }));
}

export async function getProjectMemberMachine(
  projectId: string,
  userId: string
): Promise<ProjectMemberMachine | null> {
  const [row] = await sql`
    SELECT pm.machine_id, m.url, m.name, mp.local_repo_path
    FROM project_members pm
    JOIN machines m ON m.id = pm.machine_id
    JOIN machine_projects mp ON mp.machine_id = pm.machine_id AND mp.project_id = pm.project_id
    WHERE pm.project_id = ${projectId} AND pm.user_id = ${userId}
  `;
  if (!row) return null;
  return {
    machineId: row.machine_id,
    machineUrl: row.url,
    machineName: row.name,
    localRepoPath: row.local_repo_path,
  };
}

export async function removeProjectMember(projectId: string, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

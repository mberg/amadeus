// ABOUTME: CRUD operations for the machine_projects and machine_access tables.
// ABOUTME: Links machines to projects with local paths, and manages per-user access grants.

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

export async function addMachineProject(
  machineId: string,
  projectId: string,
  localRepoPath: string
): Promise<MachineProject> {
  const [row] = await sql`
    INSERT INTO machine_projects (machine_id, project_id, local_repo_path)
    VALUES (${machineId}, ${projectId}, ${localRepoPath})
    ON CONFLICT (machine_id, project_id) DO UPDATE SET local_repo_path = ${localRepoPath}
    RETURNING machine_id, project_id, local_repo_path
  `;
  return { machineId: row.machine_id, projectId: row.project_id, localRepoPath: row.local_repo_path };
}

export async function ensureMachineProject(machineId: string, projectId: string): Promise<void> {
  await sql`
    INSERT INTO machine_projects (machine_id, project_id, local_repo_path)
    VALUES (${machineId}, ${projectId}, '')
    ON CONFLICT (machine_id, project_id) DO NOTHING
  `;
}

export async function getMachineProjects(machineId: string): Promise<MachineProject[]> {
  const rows = await sql`
    SELECT machine_id, project_id, local_repo_path
    FROM machine_projects WHERE machine_id = ${machineId}
  `;
  return rows.map((row) => ({
    machineId: row.machine_id,
    projectId: row.project_id,
    localRepoPath: row.local_repo_path,
  }));
}

export interface MachineForProject {
  machineId: string;
  projectId: string;
  localRepoPath: string;
  machineUrl: string;
  machineName: string;
}

export async function getMachinesForProject(projectId: string): Promise<MachineForProject[]> {
  const rows = await sql`
    SELECT mp.machine_id, mp.project_id, mp.local_repo_path, m.url, m.name
    FROM machine_projects mp
    JOIN machines m ON m.id = mp.machine_id
    WHERE mp.project_id = ${projectId}
  `;
  return rows.map((row) => ({
    machineId: row.machine_id,
    projectId: row.project_id,
    localRepoPath: row.local_repo_path,
    machineUrl: row.url,
    machineName: row.name,
  }));
}

export async function removeMachineProject(machineId: string, projectId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM machine_projects WHERE machine_id = ${machineId} AND project_id = ${projectId}
  `;
  return result.count > 0;
}

// --- Machine Access ---

export async function addMachineAccess(machineId: string, userId: string): Promise<MachineAccessEntry> {
  const [row] = await sql`
    INSERT INTO machine_access (machine_id, user_id)
    VALUES (${machineId}, ${userId})
    ON CONFLICT (machine_id, user_id) DO NOTHING
    RETURNING machine_id, user_id
  `;
  if (row) {
    return { machineId: row.machine_id, userId: row.user_id };
  }
  return { machineId, userId };
}

export async function getMachineAccessList(machineId: string): Promise<MachineAccessEntry[]> {
  const rows = await sql`
    SELECT machine_id, user_id FROM machine_access WHERE machine_id = ${machineId}
  `;
  return rows.map((row) => ({ machineId: row.machine_id, userId: row.user_id }));
}

export async function removeMachineAccess(machineId: string, userId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM machine_access WHERE machine_id = ${machineId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

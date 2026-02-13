// ABOUTME: REST API handlers for managing hub entities.
// ABOUTME: Provides CRUD endpoints for users, projects, machines, and their relationships.

import { getUsersByOrg, createUser, deleteUser, updateUserLinearId } from "../db/users";
import { addOrgMember, removeOrgMember } from "../db/org-members";
import { getProjectsByOrg, createProject, updateProject, deleteProject, unlinkProjectsFromRealm } from "../db/projects";
import {
  addMachineProject,
  getMachineProjects,
  removeMachineProject,
  addMachineAccess,
  getMachineAccessList,
  removeMachineAccess,
  ensureMachineProject,
} from "../db/machine-projects";
import { addProjectMember, getProjectMembers, removeProjectMember } from "../db/project-members";
import { getMachines, setSecret, getSecret, deleteSecret, listSecretKeys } from "../db";
import { createRealm, getRealmsByOrg, getRealm, updateRealm, deleteRealm as dbDeleteRealm } from "../db/realms";
import { addRealmMember, getRealmMembers, removeRealmMember, getUserRealms, updateRealmMemberLinearId } from "../db/realm-members";
import { rebuildRealmConfig } from "../config";
import { fetchLinearUserId } from "../linear";

// --- Users ---

export async function handleGetUsers(orgId: string): Promise<Response> {
  const users = await getUsersByOrg(orgId);
  return Response.json(users);
}

export async function handleCreateUser(req: Request, orgId: string): Promise<Response> {
  const body = (await req.json()) as { name: string; email: string };
  if (!body.name || !body.email) {
    return Response.json({ error: "name and email are required" }, { status: 400 });
  }
  const user = await createUser({ orgId, name: body.name, email: body.email, authMethod: "api_key" });
  await addOrgMember(orgId, user.id, "member");
  return Response.json(user, { status: 201 });
}

export async function handleDeleteUser(orgId: string, userId: string): Promise<Response> {
  await removeOrgMember(orgId, userId);
  const deleted = await deleteUser(userId);
  if (!deleted) return Response.json({ error: "User not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

export async function handleSetUserLinearPat(
  req: Request,
  orgId: string,
  userId: string
): Promise<Response> {
  const body = (await req.json()) as { pat: string; realmId?: string };
  if (!body.pat) {
    return Response.json({ error: "pat is required" }, { status: 400 });
  }

  const linearUserId = await fetchLinearUserId(body.pat);
  if (!linearUserId) {
    return Response.json({ error: "Invalid Linear API key" }, { status: 400 });
  }

  const secretKey = body.realmId
    ? `user:${userId}:realm:${body.realmId}:linear_pat`
    : `user:${userId}:linear_pat`;
  await setSecret(orgId, secretKey, body.pat);
  await updateUserLinearId(userId, linearUserId);

  // Ensure user is a realm member and store per-realm Linear identity
  if (body.realmId) {
    await addRealmMember(body.realmId, userId, "member");
    await updateRealmMemberLinearId(body.realmId, userId, linearUserId);
  }

  return Response.json({ linearUserId });
}

export async function handleGetUserLinearPats(
  orgId: string,
  userId: string
): Promise<Response> {
  const keys = await listSecretKeys(orgId, `user:${userId}:`);
  const patKeys = keys.filter((k) => k.endsWith(":linear_pat"));

  const pats = patKeys.map((key) => {
    // Key formats: "user:{id}:realm:{realmId}:linear_pat" or "user:{id}:linear_pat"
    const realmMatch = key.match(/^user:[^:]+:realm:([^:]+):linear_pat$/);
    return {
      realmId: realmMatch ? realmMatch[1] : null,
      hasToken: true,
    };
  });

  return Response.json(pats);
}

export async function handleDeleteUserLinearPat(
  req: Request,
  orgId: string,
  userId: string
): Promise<Response> {
  const body = (await req.json()) as { realmId?: string };
  const secretKey = body.realmId
    ? `user:${userId}:realm:${body.realmId}:linear_pat`
    : `user:${userId}:linear_pat`;

  const deleted = await deleteSecret(orgId, secretKey);
  if (!deleted) return Response.json({ error: "PAT not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

// --- Projects ---

export async function handleGetProjects(orgId: string): Promise<Response> {
  const projects = await getProjectsByOrg(orgId);
  return Response.json(projects);
}

export async function handleCreateProject(req: Request, orgId: string): Promise<Response> {
  const body = (await req.json()) as {
    name: string;
    linearProjectUrl?: string;
    githubRepoUrl?: string;
    linearTeamKey?: string;
    linearProjectName?: string;
    realmId?: string;
  };
  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }
  const project = await createProject({ orgId, ...body });
  return Response.json(project, { status: 201 });
}

export async function handleUpdateProject(req: Request, orgId: string, projectId: string): Promise<Response> {
  const body = (await req.json()) as {
    name?: string;
    linearProjectUrl?: string | null;
    githubRepoUrl?: string | null;
    linearTeamKey?: string | null;
    linearProjectName?: string | null;
    realmId?: string | null;
  };
  const updated = await updateProject(projectId, orgId, body);
  if (!updated) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(updated);
}

export async function handleDeleteProject(orgId: string, projectId: string): Promise<Response> {
  const deleted = await deleteProject(projectId, orgId);
  if (!deleted) return Response.json({ error: "Project not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

// --- Machines ---

export async function handleGetMachines(orgId: string): Promise<Response> {
  const machines = await getMachines(orgId);
  return Response.json(machines);
}

// --- Machine Projects ---

export async function handleGetMachineProjects(machineId: string): Promise<Response> {
  const projects = await getMachineProjects(machineId);
  return Response.json(projects);
}

export async function handleAddMachineProject(req: Request, machineId: string): Promise<Response> {
  const body = (await req.json()) as { projectId: string; localRepoPath: string };
  if (!body.projectId || !body.localRepoPath) {
    return Response.json({ error: "projectId and localRepoPath are required" }, { status: 400 });
  }
  await addMachineProject(machineId, body.projectId, body.localRepoPath);
  return new Response(null, { status: 204 });
}

export async function handleRemoveMachineProject(
  machineId: string,
  projectId: string
): Promise<Response> {
  const removed = await removeMachineProject(machineId, projectId);
  if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

// --- Machine Access ---

export async function handleGetMachineAccess(machineId: string): Promise<Response> {
  const access = await getMachineAccessList(machineId);
  return Response.json(access);
}

export async function handleAddMachineAccess(req: Request, machineId: string): Promise<Response> {
  const body = (await req.json()) as { userId: string };
  if (!body.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  await addMachineAccess(machineId, body.userId);
  return new Response(null, { status: 204 });
}

export async function handleRemoveMachineAccess(
  machineId: string,
  userId: string
): Promise<Response> {
  const removed = await removeMachineAccess(machineId, userId);
  if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

// --- Project Members ---

export async function handleGetProjectMembers(projectId: string): Promise<Response> {
  const members = await getProjectMembers(projectId);
  return Response.json(members);
}

export async function handleAddProjectMember(req: Request, projectId: string): Promise<Response> {
  const body = (await req.json()) as { userId: string; machineId: string };
  if (!body.userId || !body.machineId) {
    return Response.json({ error: "userId and machineId are required" }, { status: 400 });
  }
  await addProjectMember(projectId, body.userId, body.machineId);
  await ensureMachineProject(body.machineId, projectId);
  return new Response(null, { status: 204 });
}

export async function handleRemoveProjectMember(
  projectId: string,
  userId: string
): Promise<Response> {
  const removed = await removeProjectMember(projectId, userId);
  if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

// --- Realms ---

export async function handleGetRealms(orgId: string): Promise<Response> {
  const realms = await getRealmsByOrg(orgId);
  const results = await Promise.all(
    realms.map(async (realm) => {
      const hasWebhookSecret = (await getSecret(orgId, `realm:${realm.id}:webhook_secret`)) !== null;
      return { ...realm, hasWebhookSecret };
    })
  );
  return Response.json(results);
}

export async function handleCreateRealm(req: Request, orgId: string): Promise<Response> {
  const body = (await req.json()) as {
    name: string;
    linearWorkspace: string;
    claudeBotUserId?: string;
    webhookSecret?: string;
  };
  if (!body.name || !body.linearWorkspace) {
    return Response.json({ error: "name and linearWorkspace are required" }, { status: 400 });
  }

  const realm = await createRealm({
    orgId,
    name: body.name,
    linearWorkspace: body.linearWorkspace,
    claudeBotUserId: body.claudeBotUserId,
  });

  if (body.webhookSecret) {
    await setSecret(orgId, `realm:${realm.id}:webhook_secret`, body.webhookSecret);
  }

  await rebuildRealmConfig(orgId);
  return Response.json(realm, { status: 201 });
}

export async function handleUpdateRealm(
  req: Request,
  orgId: string,
  realmId: string
): Promise<Response> {
  const body = (await req.json()) as {
    name?: string;
    linearWorkspace?: string;
    claudeBotUserId?: string | null;
    webhookSecret?: string;
  };

  const realm = await getRealm(realmId);
  if (!realm || realm.orgId !== orgId) {
    return Response.json({ error: "Realm not found" }, { status: 404 });
  }

  const updated = await updateRealm(realmId, {
    name: body.name,
    linearWorkspace: body.linearWorkspace,
    claudeBotUserId: body.claudeBotUserId,
  });

  if (body.webhookSecret) {
    await setSecret(orgId, `realm:${realmId}:webhook_secret`, body.webhookSecret);
  }

  await rebuildRealmConfig(orgId);
  return Response.json(updated);
}

export async function handleDeleteRealm(orgId: string, realmId: string): Promise<Response> {
  // Unlink projects from this realm before deleting
  await unlinkProjectsFromRealm(realmId);

  const deleted = await dbDeleteRealm(realmId, orgId);
  if (!deleted) return Response.json({ error: "Realm not found" }, { status: 404 });

  // Clean up associated secrets
  await deleteSecret(orgId, `realm:${realmId}:webhook_secret`);

  await rebuildRealmConfig(orgId);
  return new Response(null, { status: 204 });
}

// --- Realm Members ---

export async function handleGetRealmMembers(realmId: string): Promise<Response> {
  const members = await getRealmMembers(realmId);
  return Response.json(members);
}

export async function handleAddRealmMember(req: Request, realmId: string): Promise<Response> {
  const body = (await req.json()) as { userId: string; role?: string };
  if (!body.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  const member = await addRealmMember(realmId, body.userId, body.role ?? "member");
  return Response.json(member, { status: 201 });
}

export async function handleRemoveRealmMember(realmId: string, userId: string): Promise<Response> {
  const removed = await removeRealmMember(realmId, userId);
  if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

export async function handleGetUserRealms(userId: string): Promise<Response> {
  const realms = await getUserRealms(userId);
  return Response.json(realms);
}

// ABOUTME: Admin tab for managing projects with list, add, delete, and member assignment.
// ABOUTME: Member assignment requires selecting both a user and a machine.

import { useState, useEffect, useCallback, Fragment } from "react";
import { Trash2, ChevronDown, ChevronRight, UserPlus, Pencil, Check, X } from "lucide-react";

interface Project {
  id: string;
  name: string;
  linearTeamKey: string | null;
  linearProjectName: string | null;
  githubRepoUrl: string | null;
  realmId: string | null;
}

interface Realm {
  id: string;
  name: string;
}

interface ProjectMemberRaw {
  projectId: string;
  userId: string;
  machineId: string;
}

interface User {
  id: string;
  name: string;
}

interface Machine {
  id: string;
  name: string;
}

export function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [realms, setRealms] = useState<Realm[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [linearTeamKey, setLinearTeamKey] = useState("");
  const [linearProjectName, setLinearProjectName] = useState("");
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [realmId, setRealmId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, ProjectMemberRaw[]>>({});
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const [memberUserId, setMemberUserId] = useState("");
  const [memberMachineId, setMemberMachineId] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLinearTeamKey, setEditLinearTeamKey] = useState("");
  const [editLinearProjectName, setEditLinearProjectName] = useState("");
  const [editGithubRepoUrl, setEditGithubRepoUrl] = useState("");
  const [editRealmId, setEditRealmId] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const userNameMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const machineNameMap = Object.fromEntries(machines.map((m) => [m.id, m.name]));

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/projects");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects(await res.json());
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsersAndMachines = useCallback(async () => {
    const [usersRes, machinesRes, realmsRes] = await Promise.all([
      fetch("/hub/api/users"),
      fetch("/hub/api/machines"),
      fetch("/hub/api/realms"),
    ]);
    if (usersRes.ok) setUsers(await usersRes.json());
    if (machinesRes.ok) setMachines(await machinesRes.json());
    if (realmsRes.ok) setRealms(await realmsRes.json());
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchUsersAndMachines();
  }, [fetchProjects, fetchUsersAndMachines]);

  async function fetchMembers(projectId: string) {
    try {
      const res = await fetch(`/hub/api/projects/${projectId}/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMembers((prev) => ({ ...prev, [projectId]: data }));
    } catch (err) {
      console.error("Failed to fetch members:", err);
    }
  }

  function handleToggleExpand(projectId: string) {
    if (expandedId === projectId) {
      setExpandedId(null);
    } else {
      setExpandedId(projectId);
      if (!members[projectId]) {
        fetchMembers(projectId);
      }
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, string> = { name };
      if (linearTeamKey) body.linearTeamKey = linearTeamKey;
      if (linearProjectName) body.linearProjectName = linearProjectName;
      if (githubRepoUrl) body.githubRepoUrl = githubRepoUrl;
      if (realmId) body.realmId = realmId;

      const res = await fetch("/hub/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setName("");
      setLinearTeamKey("");
      setLinearProjectName("");
      setGithubRepoUrl("");
      setRealmId("");
      await fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add project");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditing(project: Project) {
    setEditingId(project.id);
    setEditName(project.name);
    setEditLinearTeamKey(project.linearTeamKey ?? "");
    setEditLinearProjectName(project.linearProjectName ?? "");
    setEditGithubRepoUrl(project.githubRepoUrl ?? "");
    setEditRealmId(project.realmId ?? "");
    setEditError(null);
  }

  async function handleSaveEdit(projectId: string) {
    setEditError(null);
    try {
      const body: Record<string, string | null> = { name: editName };
      body.linearTeamKey = editLinearTeamKey || null;
      body.linearProjectName = editLinearProjectName || null;
      body.githubRepoUrl = editGithubRepoUrl || null;
      body.realmId = editRealmId || null;

      const res = await fetch(`/hub/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setEditingId(null);
      await fetchProjects();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update project");
    }
  }

  async function handleDelete(projectId: string) {
    try {
      const res = await fetch(`/hub/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchProjects();
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  }

  async function handleAddMember(projectId: string) {
    setMemberError(null);
    try {
      const res = await fetch(`/hub/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberUserId, machineId: memberMachineId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMemberUserId("");
      setMemberMachineId("");
      setAddingMemberId(null);
      await fetchMembers(projectId);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Failed to add member");
    }
  }

  async function handleRemoveMember(projectId: string, userId: string) {
    try {
      const res = await fetch(`/hub/api/projects/${projectId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchMembers(projectId);
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading projects...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Add project form */}
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-medium">Add Project</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="projectName" className="text-xs font-medium text-muted-foreground">
              Name *
            </label>
            <input
              id="projectName"
              type="text"
              placeholder="My Project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="githubRepoUrl" className="text-xs font-medium text-muted-foreground">
              GitHub Repo URL
            </label>
            <input
              id="githubRepoUrl"
              type="url"
              placeholder="https://github.com/org/repo"
              value={githubRepoUrl}
              onChange={(e) => setGithubRepoUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="linearTeamKey" className="text-xs font-medium text-muted-foreground">
              Linear Team Key
            </label>
            <input
              id="linearTeamKey"
              type="text"
              placeholder="ENG"
              value={linearTeamKey}
              onChange={(e) => setLinearTeamKey(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="linearProjectName" className="text-xs font-medium text-muted-foreground">
              Linear Project
            </label>
            <input
              id="linearProjectName"
              type="text"
              placeholder="Sprint 1"
              value={linearProjectName}
              onChange={(e) => setLinearProjectName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {realms.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="projectRealm" className="text-xs font-medium text-muted-foreground">
                Realm
              </label>
              <select
                id="projectRealm"
                value={realmId}
                onChange={(e) => setRealmId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">None</option>
                {realms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Adding..." : "Add Project"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>

      {/* Projects table */}
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium w-8"></th>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Realm</th>
              <th className="pb-2 font-medium">Linear Team</th>
              <th className="pb-2 font-medium">Linear Project</th>
              <th className="pb-2 font-medium w-16">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <Fragment key={project.id}>
                <tr className="border-b border-border/50">
                  <td className="py-2.5">
                    <button
                      onClick={() => handleToggleExpand(project.id)}
                      className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
                    >
                      {expandedId === project.id ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </td>
                  {editingId === project.id ? (
                    <>
                      <td className="py-2.5">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-2.5">
                        <select
                          value={editRealmId}
                          onChange={(e) => setEditRealmId(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">None</option>
                          {realms.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5">
                        <input
                          type="text"
                          value={editLinearTeamKey}
                          onChange={(e) => setEditLinearTeamKey(e.target.value)}
                          placeholder="ENG"
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-2.5">
                        <input
                          type="text"
                          value={editLinearProjectName}
                          onChange={(e) => setEditLinearProjectName(e.target.value)}
                          placeholder="Sprint 1"
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleSaveEdit(project.id)}
                            className="p-1 rounded hover:bg-green-500/10 text-muted-foreground hover:text-green-600 transition-colors"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {editError && <p className="text-xs text-destructive mt-1">{editError}</p>}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2.5">{project.name}</td>
                      <td className="py-2.5 text-muted-foreground">
                        {project.realmId
                          ? realms.find((r) => r.id === project.realmId)?.name ?? <span className="text-muted-foreground/50">&mdash;</span>
                          : <span className="text-muted-foreground/50">&mdash;</span>}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {project.linearTeamKey || <span className="text-muted-foreground/50">&mdash;</span>}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {project.linearProjectName || <span className="text-muted-foreground/50">&mdash;</span>}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEditing(project)}
                            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit project"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(project.id)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete project"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
                {expandedId === project.id && (
                  <tr className="border-b border-border/50">
                    <td colSpan={6} className="py-2 pl-9">
                      <ProjectMembersList
                        projectId={project.id}
                        members={members[project.id]}
                        users={users}
                        machines={machines}
                        userNameMap={userNameMap}
                        machineNameMap={machineNameMap}
                        addingMemberId={addingMemberId}
                        memberUserId={memberUserId}
                        memberMachineId={memberMachineId}
                        memberError={memberError}
                        onStartAdding={() => {
                          setAddingMemberId(project.id);
                          setMemberUserId("");
                          setMemberMachineId("");
                          setMemberError(null);
                        }}
                        onCancelAdding={() => setAddingMemberId(null)}
                        onUserChange={setMemberUserId}
                        onMachineChange={setMemberMachineId}
                        onAddMember={() => handleAddMember(project.id)}
                        onRemoveMember={(userId) => handleRemoveMember(project.id, userId)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProjectMembersList({
  projectId,
  members,
  users,
  machines,
  userNameMap,
  machineNameMap,
  addingMemberId,
  memberUserId,
  memberMachineId,
  memberError,
  onStartAdding,
  onCancelAdding,
  onUserChange,
  onMachineChange,
  onAddMember,
  onRemoveMember,
}: {
  projectId: string;
  members?: ProjectMemberRaw[];
  users: User[];
  machines: Machine[];
  userNameMap: Record<string, string>;
  machineNameMap: Record<string, string>;
  addingMemberId: string | null;
  memberUserId: string;
  memberMachineId: string;
  memberError: string | null;
  onStartAdding: () => void;
  onCancelAdding: () => void;
  onUserChange: (val: string) => void;
  onMachineChange: (val: string) => void;
  onAddMember: () => void;
  onRemoveMember: (userId: string) => void;
}) {
  if (!members) {
    return <span className="text-xs text-muted-foreground">Loading members...</span>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Members</span>
        <button
          onClick={onStartAdding}
          className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Add member"
        >
          <UserPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {members.length === 0 && (
        <span className="text-xs text-muted-foreground/50">No members assigned.</span>
      )}

      {members.map((m) => (
        <div key={m.userId} className="text-xs flex items-center gap-3">
          <span>{userNameMap[m.userId] ?? m.userId}</span>
          <span className="text-muted-foreground">on</span>
          <span className="text-muted-foreground">{machineNameMap[m.machineId] ?? m.machineId}</span>
          <button
            onClick={() => onRemoveMember(m.userId)}
            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove member"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      {addingMemberId === projectId && (
        <div className="flex items-end gap-2 mt-1">
          <select
            value={memberUserId}
            onChange={(e) => onUserChange(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select user...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select
            value={memberMachineId}
            onChange={(e) => onMachineChange(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select machine...</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            onClick={onAddMember}
            disabled={!memberUserId || !memberMachineId}
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Add
          </button>
          <button
            onClick={onCancelAdding}
            className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
          {memberError && <p className="text-xs text-destructive">{memberError}</p>}
        </div>
      )}
    </div>
  );
}

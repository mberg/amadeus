// ABOUTME: Admin tab for managing realms with list, add, delete, and webhook secret management.
// ABOUTME: Uses /hub/api/realms endpoints for CRUD operations including member management.

import { useState, useEffect, useCallback } from "react";
import { Trash2, Eye, EyeOff, Users, X, Pencil, Check } from "lucide-react";

interface Realm {
  id: string;
  name: string;
  linearWorkspace: string;
  claudeBotUserId: string | null;
  hasWebhookSecret: boolean;
}

interface RealmMember {
  realmId: string;
  userId: string;
  role: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

export function RealmsTab() {
  const [realms, setRealms] = useState<Realm[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [linearWorkspace, setLinearWorkspace] = useState("");
  const [claudeBotUserId, setClaudeBotUserId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Webhook secret rotation state
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateWebhookSecret, setRotateWebhookSecret] = useState("");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateSubmitting, setRotateSubmitting] = useState(false);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLinearWorkspace, setEditLinearWorkspace] = useState("");
  const [editClaudeBotUserId, setEditClaudeBotUserId] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Members management state
  const [membersRealmId, setMembersRealmId] = useState<string | null>(null);
  const [members, setMembers] = useState<RealmMember[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);

  const fetchRealms = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/realms");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRealms(await res.json());
    } catch (err) {
      console.error("Failed to fetch realms:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRealms();
  }, [fetchRealms]);

  const fetchMembers = useCallback(async (realmId: string) => {
    setMembersLoading(true);
    try {
      const [membersRes, usersRes] = await Promise.all([
        fetch(`/hub/api/realms/${realmId}/members`),
        fetch("/hub/api/users"),
      ]);
      if (membersRes.ok) setMembers(await membersRes.json());
      if (usersRes.ok) setAllUsers(await usersRes.json());
    } catch (err) {
      console.error("Failed to fetch members:", err);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, string> = { name, linearWorkspace };
      if (claudeBotUserId) body.claudeBotUserId = claudeBotUserId;
      if (webhookSecret) body.webhookSecret = webhookSecret;

      const res = await fetch("/hub/api/realms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setName("");
      setLinearWorkspace("");
      setClaudeBotUserId("");
      setWebhookSecret("");
      setShowWebhookSecret(false);
      await fetchRealms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add realm");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditingRealm(realm: Realm) {
    setEditingId(realm.id);
    setEditName(realm.name);
    setEditLinearWorkspace(realm.linearWorkspace);
    setEditClaudeBotUserId(realm.claudeBotUserId ?? "");
    setEditError(null);
  }

  async function handleSaveEdit(realmId: string) {
    setEditError(null);
    try {
      const body: Record<string, string | null> = {
        name: editName,
        linearWorkspace: editLinearWorkspace,
        claudeBotUserId: editClaudeBotUserId || null,
      };
      const res = await fetch(`/hub/api/realms/${realmId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setEditingId(null);
      await fetchRealms();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update realm");
    }
  }

  async function handleDelete(realmId: string, realmName: string) {
    if (deleteConfirmName !== realmName) {
      setDeleteError("Name does not match");
      return;
    }
    setDeleteError(null);
    try {
      const res = await fetch(`/hub/api/realms/${realmId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDeletingId(null);
      setDeleteConfirmName("");
      await fetchRealms();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete realm");
    }
  }

  async function handleRotateSecret(realmId: string) {
    if (!rotateWebhookSecret) {
      setRotateError("Enter a webhook secret");
      return;
    }
    setRotateError(null);
    setRotateSubmitting(true);
    try {
      const res = await fetch(`/hub/api/realms/${realmId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookSecret: rotateWebhookSecret }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRotatingId(null);
      setRotateWebhookSecret("");
      await fetchRealms();
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : "Failed to update secret");
    } finally {
      setRotateSubmitting(false);
    }
  }

  async function handleAddMember(realmId: string) {
    if (!addMemberUserId) return;
    try {
      const res = await fetch(`/hub/api/realms/${realmId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: addMemberUserId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setAddMemberUserId("");
      await fetchMembers(realmId);
    } catch (err) {
      console.error("Failed to add member:", err);
    }
  }

  async function handleRemoveMember(realmId: string, userId: string) {
    try {
      const res = await fetch(`/hub/api/realms/${realmId}/members/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchMembers(realmId);
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading realms...</div>;
  }

  // Users not already members of the currently expanded realm
  const availableUsers = allUsers.filter(
    (u) => !members.some((m) => m.userId === u.id)
  );

  return (
    <div className="space-y-6">
      {/* Add realm form */}
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-medium">Add Realm</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="realmName" className="text-xs font-medium text-muted-foreground">
              Name *
            </label>
            <input
              id="realmName"
              type="text"
              placeholder="production"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="realmWorkspace" className="text-xs font-medium text-muted-foreground">
              Linear Workspace *
            </label>
            <input
              id="realmWorkspace"
              type="text"
              placeholder="acme-corp"
              value={linearWorkspace}
              onChange={(e) => setLinearWorkspace(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="realmWebhookSecret" className="text-xs font-medium text-muted-foreground">
              Webhook Secret
            </label>
            <div className="relative">
              <input
                id="realmWebhookSecret"
                type={showWebhookSecret ? "text" : "password"}
                placeholder="whsec_..."
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring pr-9"
              />
              <button
                type="button"
                onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
              >
                {showWebhookSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="realmBotUserId" className="text-xs font-medium text-muted-foreground">
              Claude Bot User ID
            </label>
            <input
              id="realmBotUserId"
              type="text"
              placeholder="optional"
              value={claudeBotUserId}
              onChange={(e) => setClaudeBotUserId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Adding..." : "Add Realm"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>

      {/* Realms table */}
      {realms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No realms yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Workspace</th>
              <th className="pb-2 font-medium">Webhook Secret</th>
              <th className="pb-2 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {realms.map((realm) => (
              <tr key={realm.id} className="border-b border-border/50">
                {editingId === realm.id ? (
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
                      <input
                        type="text"
                        value={editLinearWorkspace}
                        onChange={(e) => setEditLinearWorkspace(e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </td>
                    <td className="py-2.5">
                      {realm.hasWebhookSecret ? (
                        <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                          configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                          missing
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleSaveEdit(realm.id)}
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
                    <td className="py-2.5">{realm.name}</td>
                    <td className="py-2.5 text-muted-foreground">{realm.linearWorkspace}</td>
                    <td className="py-2.5">
                      {realm.hasWebhookSecret ? (
                        <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                          configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                          missing
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditingRealm(realm)}
                          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit realm"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            const newId = membersRealmId === realm.id ? null : realm.id;
                            setMembersRealmId(newId);
                            setAddMemberUserId("");
                            if (newId) fetchMembers(newId);
                          }}
                          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                          title="Manage members"
                        >
                          <Users className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setRotatingId(rotatingId === realm.id ? null : realm.id);
                            setRotateWebhookSecret("");
                            setRotateError(null);
                          }}
                          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors text-xs"
                          title="Update webhook secret"
                        >
                          Secret
                        </button>
                        <button
                          onClick={() => {
                            setDeletingId(deletingId === realm.id ? null : realm.id);
                            setDeleteConfirmName("");
                            setDeleteError(null);
                          }}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete realm"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Members management */}
      {membersRealmId && (
        <div className="p-3 rounded-md border border-border bg-card space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground">
            Members of {realms.find((r) => r.id === membersRealmId)?.name}
          </h4>
          {membersLoading ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground">No members yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => {
                    const user = allUsers.find((u) => u.id === m.userId);
                    return (
                      <span
                        key={m.userId}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
                      >
                        {user?.name ?? m.userId}
                        <button
                          onClick={() => handleRemoveMember(membersRealmId, m.userId)}
                          className="p-0.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove member"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {availableUsers.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={addMemberUserId}
                    onChange={(e) => setAddMemberUserId(e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Select user...</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleAddMember(membersRealmId)}
                    disabled={!addMemberUserId}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    Add
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {deletingId && (() => {
        const realm = realms.find((r) => r.id === deletingId);
        if (!realm) return null;
        return (
          <div className="p-3 rounded-md border border-destructive/50 bg-destructive/5 space-y-3">
            <p className="text-sm">
              This will permanently delete the realm <strong>{realm.name}</strong> and
              remove its webhook secret. Projects linked to this realm will be unlinked.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Type <strong>{realm.name}</strong> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={realm.name}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDelete(deletingId, realm.name)}
                disabled={deleteConfirmName !== realm.name}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                Delete Realm
              </button>
              <button
                onClick={() => {
                  setDeletingId(null);
                  setDeleteConfirmName("");
                  setDeleteError(null);
                }}
                className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
            </div>
          </div>
        );
      })()}

      {/* Webhook secret rotation form */}
      {rotatingId && (
        <div className="p-3 rounded-md border border-border bg-card space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground">
            Update webhook secret for {realms.find((r) => r.id === rotatingId)?.name}
          </h4>
          <div className="space-y-1">
            <input
              type="password"
              placeholder="whsec_..."
              value={rotateWebhookSecret}
              onChange={(e) => setRotateWebhookSecret(e.target.value)}
              className="w-full max-w-md rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRotateSecret(rotatingId)}
              disabled={rotateSubmitting}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {rotateSubmitting ? "Updating..." : "Update"}
            </button>
            <button
              onClick={() => {
                setRotatingId(null);
                setRotateWebhookSecret("");
                setRotateError(null);
              }}
              className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            {rotateError && <p className="text-xs text-destructive">{rotateError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

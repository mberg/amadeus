// ABOUTME: Self-service account page for managing Linear PATs per realm.
// ABOUTME: Allows signed-in users to add, view, and remove their own Linear tokens.

import { useState, useEffect, useCallback } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";

interface Realm {
  id: string;
  name: string;
}

interface PatEntry {
  realmId: string | null;
  hasToken: boolean;
}

export function AccountPage() {
  const { user, hubUserId } = useAuth();
  const [realms, setRealms] = useState<Realm[]>([]);
  const [pats, setPats] = useState<PatEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newPat, setNewPat] = useState("");
  const [newPatRealmId, setNewPatRealmId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState<string | null>(null);

  const fetchPats = useCallback(async () => {
    if (!hubUserId) return;
    try {
      const res = await fetch(`/hub/api/users/${hubUserId}/linear-pats`);
      if (res.ok) setPats(await res.json());
    } catch (err) {
      console.error("Failed to fetch PATs:", err);
    }
  }, [hubUserId]);

  const fetchRealms = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/realms");
      if (res.ok) setRealms(await res.json());
    } catch {
      // Realms may not be available
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchPats(), fetchRealms()]).finally(() => setLoading(false));
  }, [fetchPats, fetchRealms]);

  function getRealmName(realmId: string | null): string {
    if (!realmId) return "All realms (global)";
    const realm = realms.find((r) => r.id === realmId);
    return realm?.name ?? realmId;
  }

  async function handleAddPat(e: React.FormEvent) {
    e.preventDefault();
    if (!hubUserId) return;
    setAddError(null);
    setAddSubmitting(true);
    try {
      const body: Record<string, string> = { pat: newPat };
      if (newPatRealmId) body.realmId = newPatRealmId;

      const res = await fetch(`/hub/api/users/${hubUserId}/linear-pat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setNewPat("");
      setNewPatRealmId("");
      setShowAddForm(false);
      await fetchPats();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add token");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleDeletePat(realmId: string | null) {
    if (!hubUserId) return;
    const key = realmId ?? "__global__";
    setDeleteSubmitting(key);
    try {
      const body: Record<string, string> = {};
      if (realmId) body.realmId = realmId;

      const res = await fetch(`/hub/api/users/${hubUserId}/linear-pat`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await fetchPats();
    } catch (err) {
      console.error("Failed to delete PAT:", err);
    } finally {
      setDeleteSubmitting(null);
    }
  }

  if (!hubUserId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account</h1>
          <p className="text-muted-foreground">Account settings are only available when signed in.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading account settings...</div>;
  }

  // Realms that don't have a PAT configured yet
  const configuredRealmIds = new Set(pats.map((p) => p.realmId));
  const unconfiguredRealms = realms.filter((r) => !configuredRealmIds.has(r.id));
  const hasGlobalPat = configuredRealmIds.has(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="text-muted-foreground">Manage your account settings and Linear tokens</p>
      </div>

      {/* User info */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-sm font-medium">Profile</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <span className="text-muted-foreground">Name</span>
          <span>{user?.name ?? "—"}</span>
          <span className="text-muted-foreground">Email</span>
          <span>{user?.email ?? "—"}</span>
        </div>
      </div>

      {/* Linear Tokens */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Linear Tokens</h3>
            <p className="text-xs text-muted-foreground">
              Personal access tokens used to interact with Linear on your behalf
            </p>
          </div>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Token
            </button>
          )}
        </div>

        {/* Add form */}
        {showAddForm && (
          <form onSubmit={handleAddPat} className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="patToken" className="text-xs font-medium text-muted-foreground">
                  Personal Access Token
                </label>
                <input
                  id="patToken"
                  type="password"
                  placeholder="lin_api_..."
                  value={newPat}
                  onChange={(e) => setNewPat(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="patRealm" className="text-xs font-medium text-muted-foreground">
                  Realm
                </label>
                <select
                  id="patRealm"
                  value={newPatRealmId}
                  onChange={(e) => setNewPatRealmId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">All realms (global)</option>
                  {realms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={addSubmitting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {addSubmitting ? "Saving..." : "Save Token"}
              </button>
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setNewPat(""); setNewPatRealmId(""); setAddError(null); }}
                className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              {addError && <p className="text-sm text-destructive">{addError}</p>}
            </div>
          </form>
        )}

        {/* PAT table */}
        {pats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Linear tokens configured.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 font-medium">Realm</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pats.map((pat) => {
                const key = pat.realmId ?? "__global__";
                return (
                  <tr key={key} className="border-b border-border/50">
                    <td className="py-2.5">{getRealmName(pat.realmId)}</td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        Configured
                      </span>
                    </td>
                    <td className="py-2.5">
                      <button
                        onClick={() => handleDeletePat(pat.realmId)}
                        disabled={deleteSubmitting === key}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        title="Remove token"
                      >
                        {deleteSubmitting === key ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

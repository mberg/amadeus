// ABOUTME: Admin tab for managing users with list, add, delete, and Linear PAT linking.
// ABOUTME: Uses /hub/api/users endpoints for CRUD operations.

import { useState, useEffect, useCallback } from "react";
import { Trash2, Key } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  linearUserId: string | null;
}

interface Realm {
  id: string;
  name: string;
}

export function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [realms, setRealms] = useState<Realm[]>([]);
  const [patUserId, setPatUserId] = useState<string | null>(null);
  const [pat, setPat] = useState("");
  const [patRealmId, setPatRealmId] = useState("");
  const [patError, setPatError] = useState<string | null>(null);
  const [patSubmitting, setPatSubmitting] = useState(false);
  const [userRealms, setUserRealms] = useState<Realm[]>([]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/users");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsers(await res.json());
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRealms = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/realms");
      if (res.ok) setRealms(await res.json());
    } catch {
      // Realms may not be available in all modes
    }
  }, []);

  const fetchUserRealms = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/hub/api/users/${userId}/realms`);
      if (!res.ok) return;
      const memberships: { realmId: string }[] = await res.json();
      const memberRealmIds = new Set(memberships.map((m) => m.realmId));
      setUserRealms(realms.filter((r) => memberRealmIds.has(r.id)));
    } catch {
      setUserRealms([]);
    }
  }, [realms]);

  useEffect(() => {
    fetchUsers();
    fetchRealms();
  }, [fetchUsers, fetchRealms]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/hub/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setName("");
      setEmail("");
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(userId: string) {
    try {
      const res = await fetch(`/hub/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchUsers();
    } catch (err) {
      console.error("Failed to delete user:", err);
    }
  }

  async function handleSetPat(e: React.FormEvent) {
    e.preventDefault();
    if (!patUserId) return;
    setPatError(null);
    setPatSubmitting(true);
    try {
      const body: Record<string, string> = { pat };
      if (patRealmId) body.realmId = patRealmId;

      const res = await fetch(`/hub/api/users/${patUserId}/linear-pat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPat("");
      setPatUserId(null);
      await fetchUsers();
    } catch (err) {
      setPatError(err instanceof Error ? err.message : "Failed to set PAT");
    } finally {
      setPatSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">Loading users...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Add user form */}
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-medium">Add User</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="userName" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              id="userName"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="userEmail" className="text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="userEmail"
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Adding..." : "Add User"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>

      {/* Users table */}
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Email</th>
              <th className="pb-2 font-medium">Linear ID</th>
              <th className="pb-2 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-border/50">
                <td className="py-2.5">{user.name}</td>
                <td className="py-2.5 text-muted-foreground">{user.email}</td>
                <td className="py-2.5">
                  {user.linearUserId ? (
                    <span className="text-xs font-mono text-muted-foreground">
                      {user.linearUserId}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">not linked</span>
                  )}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const newId = patUserId === user.id ? null : user.id;
                        setPatUserId(newId);
                        setPat("");
                        setPatRealmId("");
                        setPatError(null);
                        if (newId) fetchUserRealms(newId);
                      }}
                      className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                      title="Link Linear PAT"
                    >
                      <Key className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Linear PAT form */}
      {patUserId && (
        <form onSubmit={handleSetPat} className="flex items-end gap-3 p-3 rounded-md border border-border bg-card">
          <div className="space-y-1 flex-1">
            <label htmlFor="linearPat" className="text-xs font-medium text-muted-foreground">
              Linear Personal Access Token for {users.find((u) => u.id === patUserId)?.name}
            </label>
            <input
              id="linearPat"
              type="password"
              placeholder="lin_api_..."
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          {userRealms.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Realm</label>
              <select
                value={patRealmId}
                onChange={(e) => setPatRealmId(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">All realms</option>
                {userRealms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={patSubmitting}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {patSubmitting ? "Linking..." : "Link"}
          </button>
          <button
            type="button"
            onClick={() => { setPatUserId(null); setPat(""); setPatRealmId(""); setPatError(null); }}
            className="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
          {patError && <p className="text-sm text-destructive">{patError}</p>}
        </form>
      )}
    </div>
  );
}

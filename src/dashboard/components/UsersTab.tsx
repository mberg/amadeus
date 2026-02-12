// ABOUTME: Admin tab for managing users with list, add, and delete.
// ABOUTME: Uses /hub/api/users endpoints for CRUD operations.

import { useState, useEffect, useCallback } from "react";
import { Trash2 } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  linearUserId: string | null;
}

export function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

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
              <th className="pb-2 font-medium w-16">Actions</th>
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
                  <button
                    onClick={() => handleDelete(user.id)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete user"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

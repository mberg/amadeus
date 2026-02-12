// ABOUTME: Admin tab for managing realms with list, add, delete, and webhook secret management.
// ABOUTME: Uses /hub/api/realms endpoints for CRUD operations.

import { useState, useEffect, useCallback } from "react";
import { Trash2, Eye, EyeOff } from "lucide-react";

interface Realm {
  id: string;
  name: string;
  linearWorkspace: string;
  claudeBotUserId: string | null;
  hasWebhookSecret: boolean;
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

  // Webhook secret rotation state
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateWebhookSecret, setRotateWebhookSecret] = useState("");
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateSubmitting, setRotateSubmitting] = useState(false);

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

  async function handleDelete(realmId: string) {
    try {
      const res = await fetch(`/hub/api/realms/${realmId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRealms();
    } catch (err) {
      console.error("Failed to delete realm:", err);
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

  if (loading) {
    return <div className="text-muted-foreground">Loading realms...</div>;
  }

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
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
              <th className="pb-2 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {realms.map((realm) => (
              <tr key={realm.id} className="border-b border-border/50">
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
                      onClick={() => handleDelete(realm.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete realm"
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

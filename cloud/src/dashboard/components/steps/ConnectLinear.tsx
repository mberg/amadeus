// ABOUTME: Onboarding step for connecting Linear with API key and webhook secret.
// ABOUTME: Collects Linear API key, webhook secret, and workspace name.

import { useState } from "react";

interface ConnectLinearProps {
  onComplete: () => void;
}

export function ConnectLinear({ onComplete }: ConnectLinearProps) {
  const [linearApiKey, setLinearApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [linearWorkspace, setLinearWorkspace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/cloud/onboarding/linear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linearApiKey, webhookSecret, linearWorkspace }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connect Linear</h1>
        <p className="text-muted-foreground mt-1">
          Connect your Linear workspace so Amadeus can receive issue webhooks and
          update issue state.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="workspace" className="text-sm font-medium">
            Workspace slug
          </label>
          <input
            id="workspace"
            type="text"
            placeholder="my-workspace"
            value={linearWorkspace}
            onChange={(e) => setLinearWorkspace(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <p className="text-xs text-muted-foreground">
            Found in Linear Settings &rarr; General &rarr; Workspace URL slug.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="apiKey" className="text-sm font-medium">
            Linear API key
          </label>
          <input
            id="apiKey"
            type="password"
            placeholder="lin_api_..."
            value={linearApiKey}
            onChange={(e) => setLinearApiKey(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <p className="text-xs text-muted-foreground">
            Create one at Linear Settings &rarr; API &rarr; Personal API keys.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="webhookSecret" className="text-sm font-medium">
            Webhook signing secret
          </label>
          <input
            id="webhookSecret"
            type="password"
            placeholder="whsec_..."
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <p className="text-xs text-muted-foreground">
            Created when you add a webhook at Linear Settings &rarr; API &rarr;
            Webhooks.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Saving..." : "Continue"}
        </button>
      </form>
    </div>
  );
}

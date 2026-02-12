// ABOUTME: Onboarding step for configuring project YAML.
// ABOUTME: Accepts raw YAML config for realm/project definitions.

import { useState } from "react";

interface ConfigureProjectsProps {
  onComplete: () => void;
}

const EXAMPLE_YAML = `realms:
  - name: default
    teams:
      - key: ENG
        projects:
          - name: Backend
            path: /path/to/repo
`;

export function ConfigureProjects({ onComplete }: ConfigureProjectsProps) {
  const [configYaml, setConfigYaml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/cloud/onboarding/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configYaml }),
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
        <h1 className="text-2xl font-bold tracking-tight">Configure Projects</h1>
        <p className="text-muted-foreground mt-1">
          Define your realms and project mappings. This tells Amadeus which
          repositories to work with and how to route webhooks.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="yaml" className="text-sm font-medium">
            Configuration YAML
          </label>
          <textarea
            id="yaml"
            rows={12}
            placeholder={EXAMPLE_YAML}
            value={configYaml}
            onChange={(e) => setConfigYaml(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            required
          />
          <p className="text-xs text-muted-foreground">
            See the Amadeus docs for the full config schema. You can edit this
            later in Settings.
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

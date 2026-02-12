// ABOUTME: Onboarding step for registering a machine with an API key.
// ABOUTME: Generates a machine API key and displays it once for the user to copy.

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface RegisterMachineProps {
  onComplete: () => void;
}

export function RegisterMachine({ onComplete }: RegisterMachineProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ machineId: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/cloud/onboarding/machine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    if (result?.apiKey) {
      navigator.clipboard.writeText(result.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (result) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Machine Registered</h1>
          <p className="text-muted-foreground mt-1">
            Your machine has been registered. Copy the API key below and add it to
            your machine&apos;s environment as{" "}
            <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">
              AMADEUS_API_KEY
            </code>
            .
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-sm font-medium">Machine ID</span>
            <p className="text-sm font-mono text-muted-foreground">{result.machineId}</p>
          </div>

          <div className="space-y-1">
            <span className="text-sm font-medium">API Key</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm font-mono break-all">
                {result.apiKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 inline-flex items-center justify-center rounded-md border border-input bg-background p-2 hover:bg-muted/50 transition-colors"
                title="Copy API key"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-destructive">
              This key is shown only once. Copy it now.
            </p>
          </div>
        </div>

        <button
          onClick={onComplete}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Register Machine</h1>
        <p className="text-muted-foreground mt-1">
          Register a machine that will run Amadeus agents. Each machine gets a
          unique API key for authentication.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="machineName" className="text-sm font-medium">
            Machine name
          </label>
          <input
            id="machineName"
            type="text"
            placeholder="production-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="machineUrl" className="text-sm font-medium">
            Machine URL
          </label>
          <input
            id="machineUrl"
            type="url"
            placeholder="https://machine.example.com:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            required
          />
          <p className="text-xs text-muted-foreground">
            The URL where the machine&apos;s Amadeus instance is reachable.
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
          {submitting ? "Registering..." : "Register Machine"}
        </button>
      </form>
    </div>
  );
}

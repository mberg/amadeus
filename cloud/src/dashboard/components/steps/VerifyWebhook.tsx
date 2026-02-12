// ABOUTME: Onboarding step for verifying the Linear webhook is working.
// ABOUTME: Marks onboarding as complete after webhook verification.

import { useState } from "react";

interface VerifyWebhookProps {
  onComplete: () => void;
}

export function VerifyWebhook({ onComplete }: VerifyWebhookProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleVerify() {
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/cloud/onboarding/verify-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Verify Webhook</h1>
        <p className="text-muted-foreground mt-1">
          Confirm that Linear webhooks are reaching your Amadeus instance. Make
          sure you&apos;ve configured the webhook URL in Linear to point to your
          cloud endpoint.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-medium">Webhook setup checklist</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>Go to Linear Settings &rarr; API &rarr; Webhooks</li>
          <li>Create a webhook pointing to your cloud URL + <code className="font-mono bg-muted px-1 py-0.5 rounded text-xs">/webhooks/linear</code></li>
          <li>Select events: Issues (created, updated, removed)</li>
          <li>Use the webhook secret you entered in step 1</li>
        </ol>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        onClick={handleVerify}
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {submitting ? "Verifying..." : "Complete Setup"}
      </button>
    </div>
  );
}

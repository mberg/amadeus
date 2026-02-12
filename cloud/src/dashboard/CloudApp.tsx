// ABOUTME: Cloud onboarding app with setup wizard.
// ABOUTME: Flow: check onboarding status → wizard steps → redirect to dashboard.

import { useState, useEffect, useCallback } from "react";
import { OnboardingWizard, type OnboardingStatus } from "./components/OnboardingWizard";

export function CloudApp() {
  return <OnboardingGate />;
}

function OnboardingGate() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/cloud/onboarding/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError("Failed to load onboarding status");
      console.error("Onboarding status fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchStatus();
  }, [fetchStatus]);

  const handleComplete = useCallback(() => {
    window.location.href = "/dashboard";
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }

  if (status?.completed) {
    window.location.href = "/dashboard";
    return null;
  }

  return (
    <OnboardingWizard
      initialStatus={status ?? { currentStep: "connect_linear", completed: false }}
      onComplete={handleComplete}
    />
  );
}

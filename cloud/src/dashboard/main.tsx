// ABOUTME: Cloud onboarding wizard React entry point.
// ABOUTME: Wraps with Better Auth session check, then renders the setup flow.

import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createAuthClient } from "better-auth/react";
import { CloudApp } from "./CloudApp";
import { SignInPage } from "./components/SignInPage";
import "./index.css";

const authClient = createAuthClient();

function Root() {
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/auth/info")
      .then((res) => res.json())
      .then((info) => {
        setAuthEnabled(info.authEnabled ?? false);
      })
      .catch(() => {
        setAuthEnabled(false);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!authEnabled) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-full max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold tracking-tight">Amadeus Cloud</h1>
          <p className="text-muted-foreground">
            Authentication is not configured. Set <code className="text-sm bg-muted px-1 py-0.5 rounded">BETTER_AUTH_SECRET</code> in your environment.
          </p>
        </div>
      </div>
    );
  }

  return <AuthGate />;
}

function AuthGate() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session?.user) {
    return <SignInPage title="Amadeus Cloud" subtitle="Sign in to get started" redirectTo="/dashboard" />;
  }

  return <CloudApp />;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);
root.render(<Root />);

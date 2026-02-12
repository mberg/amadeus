// ABOUTME: Admin panel React entry point.
// ABOUTME: Wraps with Better Auth session check, then renders the admin panel.

import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createAuthClient } from "better-auth/react";
import { AdminPanel } from "./components/AdminPanel";
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
    return <AdminPanel />;
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
    return <SignInPage title="Amadeus Admin" subtitle="Sign in to manage your organization" redirectTo="/dashboard" />;
  }

  return <AdminPanel />;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);
root.render(<Root />);

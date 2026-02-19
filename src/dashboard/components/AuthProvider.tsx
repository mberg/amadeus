// ABOUTME: Authentication provider that wraps the app with Better Auth when enabled.
// ABOUTME: Handles both simple mode (no auth) and Better Auth mode with role-based access.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authClient } from "../lib/auth-client";

export type AuthMode = "simple" | "betterauth";
export type UserRole = "viewer" | "operator" | "admin";

interface AuthInfo {
  mode: AuthMode;
  authEnabled: boolean;
}

interface MeResponse {
  authenticated: boolean;
  accessDenied?: boolean;
  message?: string;
  user?: { id: string; name: string; email: string; image?: string };
  role?: UserRole;
  hubUserId?: string | null;
}

interface AuthContextValue {
  mode: AuthMode;
  loading: boolean;
  role: UserRole;
  canMessage: boolean;
  canEditConfig: boolean;
  enableAgentMessaging?: boolean;
  user?: { id: string; name: string; email: string; image?: string };
  hubUserId?: string;
  isSignedIn: boolean;
  accessibleMachines: Set<string> | null; // null = no restriction (admin or simple mode)
}

const AuthContext = createContext<AuthContextValue>({
  mode: "simple",
  loading: true,
  role: "viewer",
  canMessage: false,
  canEditConfig: false,
  isSignedIn: false,
  accessibleMachines: null,
});

export function useAuth() {
  return useContext(AuthContext);
}

function BetterAuthContent({ children, enableAgentMessaging }: { children: ReactNode; enableAgentMessaging?: boolean }) {
  const { data: session, isPending } = authClient.useSession();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mePending, setMePending] = useState(true);
  const [accessibleMachines, setAccessibleMachines] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      setMe({ authenticated: false });
      setMePending(false);
      return;
    }

    Promise.all([
      fetch("/auth/me").then((res) => res.json()),
      fetch("/hub/my-machines").then((res) => res.json()).catch(() => ({ machineNames: [] })),
    ])
      .then(([meData, machinesData]: [MeResponse, { machineNames?: string[] }]) => {
        setMe(meData);
        if (meData.role === "admin") {
          setAccessibleMachines(null);
        } else {
          setAccessibleMachines(new Set(machinesData.machineNames ?? []));
        }
      })
      .catch(() => setMe({ authenticated: false }))
      .finally(() => setMePending(false));
  }, [session?.user?.id, isPending]);

  const loading = isPending || mePending;
  const role = me?.role ?? "viewer";
  const canMessage = role === "operator" || role === "admin";
  const canEditConfig = role === "admin";
  const isSignedIn = !!session?.user;

  // Show access denied screen if user is authenticated but not registered
  if (!loading && me?.accessDenied) {
    return <AccessDeniedPage message={me.message} />;
  }

  const value: AuthContextValue = {
    mode: "betterauth",
    loading,
    role,
    canMessage,
    canEditConfig,
    enableAgentMessaging,
    user: me?.user,
    hubUserId: me?.hubUserId ?? undefined,
    isSignedIn,
    accessibleMachines,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

function SimpleAuthContent({ children, enableAgentMessaging }: { children: ReactNode; enableAgentMessaging?: boolean }) {
  const canMessage = enableAgentMessaging ?? false;

  const value: AuthContextValue = {
    mode: "simple",
    loading: false,
    role: canMessage ? "operator" : "viewer",
    canMessage,
    canEditConfig: false,
    enableAgentMessaging,
    isSignedIn: false,
    accessibleMachines: null,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [enableAgentMessaging, setEnableAgentMessaging] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAuthInfo() {
      try {
        const [authRes, configRes] = await Promise.all([
          fetch("/auth/info"),
          fetch("/config"),
        ]);

        if (authRes.ok) {
          const info = await authRes.json();
          setAuthInfo(info);
        }

        if (configRes.ok) {
          const config = await configRes.json();
          setEnableAgentMessaging(config.setup?.global?.security?.enableAgentMessaging);
        }
      } catch (error) {
        console.error("Failed to fetch auth info:", error);
        setAuthInfo({ mode: "simple", authEnabled: false });
      } finally {
        setLoading(false);
      }
    }

    fetchAuthInfo();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (authInfo?.authEnabled) {
    return (
      <BetterAuthContent enableAgentMessaging={enableAgentMessaging}>
        {children}
      </BetterAuthContent>
    );
  }

  return (
    <SimpleAuthContent enableAgentMessaging={enableAgentMessaging}>
      {children}
    </SimpleAuthContent>
  );
}

function AccessDeniedPage({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Amadeus</h1>
        </div>
        <div className="bg-card border rounded-lg shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            {message ?? "Your account has not been registered. Please contact your administrator to request access."}
          </p>
          <button
            type="button"
            onClick={() => {
              authClient.signOut().then(() => window.location.reload());
            }}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProtectedProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function Protected({ children, fallback }: ProtectedProps) {
  const { mode, loading, isSignedIn } = useAuth();

  if (mode === "simple") {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

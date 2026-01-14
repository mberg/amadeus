// ABOUTME: Authentication provider that wraps the app with Clerk when enabled.
// ABOUTME: Handles both simple mode (no auth) and Clerk mode with role-based access.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ClerkProvider, SignedIn, SignedOut, useUser } from "@clerk/clerk-react";

export type AuthMode = "simple" | "clerk";
export type UserRole = "viewer" | "operator" | "admin";

interface AuthInfo {
  mode: AuthMode;
  clerkEnabled: boolean;
  publishableKey?: string;
}

interface AuthContextValue {
  mode: AuthMode;
  loading: boolean;
  role: UserRole;
  canMessage: boolean;
  canEditConfig: boolean;
  enableAgentMessaging?: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  mode: "simple",
  loading: true,
  role: "viewer",
  canMessage: false,
  canEditConfig: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

function ClerkAuthContent({ children, enableAgentMessaging }: { children: ReactNode; enableAgentMessaging?: boolean }) {
  const { user, isLoaded } = useUser();

  const role = (user?.publicMetadata?.role as UserRole) || "viewer";
  const canMessage = role === "operator" || role === "admin";
  const canEditConfig = role === "admin";

  const value: AuthContextValue = {
    mode: "clerk",
    loading: !isLoaded,
    role,
    canMessage,
    canEditConfig,
    enableAgentMessaging,
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
        setAuthInfo({ mode: "simple", clerkEnabled: false });
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

  if (authInfo?.clerkEnabled && authInfo.publishableKey) {
    return (
      <ClerkProvider publishableKey={authInfo.publishableKey}>
        <ClerkAuthContent enableAgentMessaging={enableAgentMessaging}>
          {children}
        </ClerkAuthContent>
      </ClerkProvider>
    );
  }

  return (
    <SimpleAuthContent enableAgentMessaging={enableAgentMessaging}>
      {children}
    </SimpleAuthContent>
  );
}

interface ProtectedProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function Protected({ children, fallback }: ProtectedProps) {
  const { mode } = useAuth();

  if (mode === "simple") {
    return <>{children}</>;
  }

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>{fallback}</SignedOut>
    </>
  );
}

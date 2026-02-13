// ABOUTME: Authentication middleware supporting both simple (API token) and Better Auth modes.
// ABOUTME: Provides role-based access control for dashboard and API endpoints.

import { auth } from "./better-auth";
import { getUserByEmail } from "./db/users";
import { getOrgMemberRole } from "./db/org-members";

/**
 * Parses a cookie header string into a key-value object.
 * Handles edge cases: values containing '=', whitespace variations, malformed entries.
 */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const cookie of cookieHeader.split(/;\s*/)) {
    const eqIndex = cookie.indexOf("=");
    if (eqIndex === -1) continue;
    const name = cookie.slice(0, eqIndex);
    const value = cookie.slice(eqIndex + 1);
    if (name) {
      cookies[name] = value;
    }
  }

  return cookies;
}

export type AuthMode = "simple" | "betterauth";
export type UserRole = "viewer" | "operator" | "admin";

export interface AuthContext {
  mode: AuthMode;
  authenticated: boolean;
  userId?: string;
  role: UserRole;
}

const MACHINE_API_KEY = process.env.AMADEUS_API_KEY;

/**
 * Check if request has valid machine-to-machine API key.
 */
function checkMachineApiKey(req: Request): AuthContext | null {
  if (!MACHINE_API_KEY) return null;

  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.slice(7) === MACHINE_API_KEY) {
    return {
      mode: "simple",
      authenticated: true,
      userId: "machine",
      role: "operator",
    };
  }
  return null;
}

export function getAuthMode(): AuthMode {
  return auth ? "betterauth" : "simple";
}

export function isBetterAuthEnabled(): boolean {
  return auth !== null;
}

function mapOrgRoleToUserRole(orgRole: string | null): UserRole {
  switch (orgRole) {
    case "admin": return "admin";
    case "member": return "operator";
    default: return "viewer";
  }
}

async function getBetterAuthSession(req: Request): Promise<AuthContext> {
  if (!auth) {
    return { mode: "simple", authenticated: false, role: "viewer" };
  }

  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session?.user) {
      return { mode: "betterauth", authenticated: false, role: "viewer" };
    }

    const email = session.user.email;
    let role: UserRole = "viewer";

    if (email) {
      const hubUser = await getUserByEmail("default", email);
      if (hubUser) {
        const orgRole = await getOrgMemberRole("default", hubUser.id);
        role = mapOrgRoleToUserRole(orgRole);
      }
    }

    return {
      mode: "betterauth",
      authenticated: true,
      userId: session.user.id,
      role,
    };
  } catch {
    return { mode: "betterauth", authenticated: false, role: "viewer" };
  }
}

function getSimpleAuth(req: Request, apiToken?: string): AuthContext {
  if (!apiToken) {
    return { mode: "simple", authenticated: false, role: "viewer" };
  }

  const token = req.headers.get("X-Amadeus-Token");
  if (token === apiToken) {
    return { mode: "simple", authenticated: true, role: "admin" };
  }

  return { mode: "simple", authenticated: false, role: "viewer" };
}

export async function getAuthContext(
  req: Request,
  apiToken?: string
): Promise<AuthContext> {
  // Check machine-to-machine API key first
  const machineAuth = checkMachineApiKey(req);
  if (machineAuth) return machineAuth;

  // Check API token (works regardless of auth mode)
  if (apiToken) {
    const token = req.headers.get("X-Amadeus-Token");
    if (token === apiToken) {
      return { mode: "simple", authenticated: true, role: "admin" };
    }
  }

  if (isBetterAuthEnabled()) {
    return getBetterAuthSession(req);
  }
  return getSimpleAuth(req, apiToken);
}

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export type AuthResult =
  | { authorized: true; context: AuthContext }
  | { authorized: false; response: Response };

export async function requireAuth(
  req: Request,
  requiredRole: UserRole,
  options: { apiToken?: string; enableAgentMessaging?: boolean } = {}
): Promise<AuthResult> {
  const context = await getAuthContext(req, options.apiToken);

  if (!context.authenticated) {
    return {
      authorized: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }

  if (context.mode === "simple") {
    // Machine-to-machine auth already grants the appropriate role
    if (context.userId === "machine" && hasRole(context.role, requiredRole)) {
      return { authorized: true, context };
    }

    const hasApiToken = options.apiToken && req.headers.get("X-Amadeus-Token") === options.apiToken;

    if (requiredRole === "admin" || requiredRole === "operator") {
      if (hasApiToken) {
        return { authorized: true, context };
      }
      if (!options.enableAgentMessaging) {
        return {
          authorized: false,
          response: new Response("Forbidden: Agent messaging disabled", { status: 403 }),
        };
      }
    }

    return { authorized: true, context };
  }

  if (!hasRole(context.role, requiredRole)) {
    return {
      authorized: false,
      response: new Response(
        `Forbidden: Requires ${requiredRole} role`,
        { status: 403 }
      ),
    };
  }

  return { authorized: true, context };
}

export function getAuthInfo(): {
  mode: AuthMode;
  authEnabled: boolean;
} {
  return {
    mode: getAuthMode(),
    authEnabled: isBetterAuthEnabled(),
  };
}

// ABOUTME: Authentication middleware supporting both simple (API token) and Clerk modes.
// ABOUTME: Provides role-based access control for dashboard and API endpoints.

import { createClerkClient, verifyToken } from "@clerk/backend";

export type AuthMode = "simple" | "clerk";
export type UserRole = "viewer" | "operator" | "admin";

export interface AuthContext {
  mode: AuthMode;
  authenticated: boolean;
  userId?: string;
  role: UserRole;
}

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

if (CLERK_SECRET_KEY && CLERK_PUBLISHABLE_KEY) {
  clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });
}

export function getAuthMode(): AuthMode {
  return clerkClient ? "clerk" : "simple";
}

export function isClerkEnabled(): boolean {
  return clerkClient !== null;
}

async function getClerkAuth(req: Request): Promise<AuthContext> {
  if (!clerkClient) {
    return { mode: "simple", authenticated: false, role: "viewer" };
  }

  const authHeader = req.headers.get("Authorization");
  const cookieHeader = req.headers.get("Cookie");

  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => c.split("="))
    );
    token = cookies["__session"];
  }

  if (!token) {
    return { mode: "clerk", authenticated: false, role: "viewer" };
  }

  try {
    const verifiedToken = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY!,
    });

    const userId = verifiedToken.sub;

    const user = await clerkClient.users.getUser(userId);
    const role = (user.publicMetadata?.role as UserRole) || "viewer";

    return {
      mode: "clerk",
      authenticated: true,
      userId,
      role,
    };
  } catch {
    return { mode: "clerk", authenticated: false, role: "viewer" };
  }
}

function getSimpleAuth(req: Request, apiToken?: string): AuthContext {
  if (!apiToken) {
    return { mode: "simple", authenticated: true, role: "admin" };
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
  if (isClerkEnabled()) {
    return getClerkAuth(req);
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
    const hasApiToken = options.apiToken && req.headers.get("X-Amadeus-Token") === options.apiToken;

    if (requiredRole === "admin") {
      return {
        authorized: false,
        response: new Response("Forbidden: Config editing requires Clerk authentication", { status: 403 }),
      };
    }

    if (requiredRole === "operator") {
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
  clerkEnabled: boolean;
  publishableKey?: string;
} {
  return {
    mode: getAuthMode(),
    clerkEnabled: isClerkEnabled(),
    publishableKey: isClerkEnabled() ? CLERK_PUBLISHABLE_KEY : undefined,
  };
}

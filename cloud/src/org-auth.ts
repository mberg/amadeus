// ABOUTME: Organization resolution from Better Auth sessions.
// ABOUTME: Extracts org_id from request by looking up the user's org membership.

import { auth } from "amadeus/better-auth";
import { ensureOrg } from "amadeus/db";
import { getUserByEmailAnyOrg } from "amadeus/src/db/users";
import { getOrgsForUser } from "amadeus/src/db/org-members";

export async function resolveOrgId(req: Request): Promise<string | null> {
  if (!auth) return null;

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.email) return null;

    // Look up the user across all orgs, then find their org membership
    const hubUser = await getUserByEmailAnyOrg(session.user.email);
    if (hubUser) {
      const orgs = await getOrgsForUser(hubUser.id);
      if (orgs.length > 0) {
        // Use the first org the user belongs to
        // TODO: support org switching when users belong to multiple orgs
        const orgId = orgs[0].orgId;
        await ensureOrg(orgId);
        return orgId;
      }
    }

    // Fallback: user exists in Better Auth but not yet in hub users
    // They'll be auto-created in /auth/me with the default org
    const orgId = "default";
    await ensureOrg(orgId);
    return orgId;
  } catch {
    return null;
  }
}

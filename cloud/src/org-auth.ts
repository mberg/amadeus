// ABOUTME: Organization resolution from Better Auth sessions.
// ABOUTME: Extracts org_id from request, ensuring the org exists in Postgres.

import { auth } from "amadeus/better-auth";
import { ensureOrg } from "amadeus/db";

export async function resolveOrgId(req: Request): Promise<string | null> {
  if (!auth) return null;

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.email) return null;

    // Without org plugin, all users are in "default" org
    const orgId = "default";
    await ensureOrg(orgId);
    return orgId;
  } catch {
    return null;
  }
}

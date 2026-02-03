// ABOUTME: Org context for multi-tenant support.
// ABOUTME: Open-source uses "default" org. Cloud layer overrides with session-based org ID.

const DEFAULT_ORG_ID = "default";

/**
 * Extract the org ID from the request URL.
 * Supports /webhook/:orgId for per-org Linear webhook URLs.
 * Returns "default" for all other paths (open-source single-tenant mode).
 */
export function getRequestOrgId(url: URL): string {
  const match = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (match && match[1]) {
    return match[1];
  }
  return DEFAULT_ORG_ID;
}

// ABOUTME: Cloud fetch handler wrapping amadeus with org resolution and cloud routes.
// ABOUTME: Mounts onboarding and admin routes before falling through to the amadeus handler.

import { createFetchHandler, type ServerContext } from "amadeus/create-server";
import { resolveOrgId } from "./org-auth";
import { handleOnboardingRoutes } from "./onboarding";
import { handleAdminRoutes } from "./admin";

export function createCloudHandler(ctx: ServerContext): (req: Request) => Promise<Response> {
  const amadeusHandler = createFetchHandler(ctx);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Resolve org from session (falls back to "default" if auth is not enabled)
    const orgId = (await resolveOrgId(req)) ?? "default";

    // Cloud routes first (onboarding, admin, etc.)
    const onboardingResponse = await handleOnboardingRoutes(req, url, orgId);
    if (onboardingResponse) return onboardingResponse;

    const adminResponse = await handleAdminRoutes(req, url, orgId);
    if (adminResponse) return adminResponse;

    // For hub API requests, inject the API token so they pass amadeus auth.
    // The cloud handler is the trust boundary — requests reaching here have
    // already passed cloud-level auth (session or simple mode).
    if (url.pathname.startsWith("/hub/api/") && process.env.AMADEUS_API_TOKEN) {
      const headers = new Headers(req.headers);
      if (!headers.has("X-Amadeus-Token")) {
        headers.set("X-Amadeus-Token", process.env.AMADEUS_API_TOKEN);
      }
      req = new Request(req, { headers });
    }

    // Everything else goes to amadeus handler
    return amadeusHandler(req);
  };
}

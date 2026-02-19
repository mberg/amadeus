// ABOUTME: Admin API route handlers for machine creation and deletion.
// ABOUTME: Wraps generateMachineApiKey for the admin UI.

import { generateMachineApiKey, regenerateMachineApiKey } from "./api-keys";
import { deleteMachine } from "../../src/db";

export async function handleAdminRoutes(
  req: Request,
  url: URL,
  orgId: string
): Promise<Response | null> {
  if (!url.pathname.startsWith("/cloud/admin/")) {
    return null;
  }

  const path = url.pathname.slice("/cloud/admin".length);

  // POST /cloud/admin/machines
  if (req.method === "POST" && path === "/machines") {
    const body = await req.json();
    const { name, url: machineUrl } = body as { name?: string; url?: string };

    if (!name || !machineUrl) {
      return Response.json(
        { error: "name and url are required" },
        { status: 400 }
      );
    }

    const { machineId, apiKey } = await generateMachineApiKey(orgId, name, machineUrl);
    return Response.json({ machineId, apiKey }, { status: 201 });
  }

  // POST /cloud/admin/machines/:id/regenerate-key
  const machineRegenerateMatch = path.match(/^\/machines\/([^/]+)\/regenerate-key$/);
  if (req.method === "POST" && machineRegenerateMatch) {
    const machineId = machineRegenerateMatch[1];
    const result = await regenerateMachineApiKey(orgId, machineId);
    if (!result) {
      return Response.json({ error: "Machine not found" }, { status: 404 });
    }
    return Response.json({ apiKey: result.apiKey });
  }

  // DELETE /cloud/admin/machines/:id
  const machineDeleteMatch = path.match(/^\/machines\/([^/]+)$/);
  if (req.method === "DELETE" && machineDeleteMatch) {
    const machineId = machineDeleteMatch[1];
    const deleted = await deleteMachine(machineId, orgId);
    if (!deleted) {
      return Response.json({ error: "Machine not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  return null;
}

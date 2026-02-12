// ABOUTME: Onboarding API route handlers for guided org setup.
// ABOUTME: Manages Linear connection, project config, machine registration, and webhook verification.

import {
  getOnboardingState,
  setOnboardingStep,
  setOnboardingFlag,
  completeOnboarding,
} from "./db/cloud-db";
import { generateMachineApiKey } from "./api-keys";
import { setSecret, saveConfigYaml } from "../../src/db";

export async function handleOnboardingRoutes(
  req: Request,
  url: URL,
  orgId: string
): Promise<Response | null> {
  if (!url.pathname.startsWith("/cloud/onboarding/")) {
    return null;
  }

  const path = url.pathname.slice("/cloud/onboarding".length);

  // GET /cloud/onboarding/status
  if (req.method === "GET" && path === "/status") {
    const state = await getOnboardingState(orgId);

    if (!state) {
      return Response.json({
        currentStep: "connect_linear",
        linearConnected: false,
        machineRegistered: false,
        webhookVerified: false,
        completed: false,
      });
    }

    return Response.json({
      currentStep: state.currentStep,
      linearConnected: state.linearConnected,
      machineRegistered: state.machineRegistered,
      webhookVerified: state.webhookVerified,
      completed: state.completedAt !== null,
    });
  }

  // POST /cloud/onboarding/linear
  if (req.method === "POST" && path === "/linear") {
    const body = await req.json();
    const { linearApiKey, webhookSecret, linearWorkspace } = body as {
      linearApiKey?: string;
      webhookSecret?: string;
      linearWorkspace?: string;
    };

    if (!linearApiKey || !webhookSecret || !linearWorkspace) {
      return Response.json(
        { error: "linearApiKey, webhookSecret, and linearWorkspace are required" },
        { status: 400 }
      );
    }

    await setSecret(orgId, "linear_api_key", linearApiKey);
    await setSecret(orgId, "linear_webhook_secret", webhookSecret);
    await setOnboardingFlag(orgId, "linear_connected", true);
    await setOnboardingStep(orgId, "configure_projects");

    return Response.json({ success: true });
  }

  // POST /cloud/onboarding/projects
  if (req.method === "POST" && path === "/projects") {
    const body = await req.json();
    const { configYaml } = body as { configYaml?: string };

    if (!configYaml) {
      return Response.json(
        { error: "configYaml is required" },
        { status: 400 }
      );
    }

    await saveConfigYaml(orgId, configYaml);
    await setOnboardingStep(orgId, "register_machine");

    return Response.json({ success: true });
  }

  // POST /cloud/onboarding/machine
  if (req.method === "POST" && path === "/machine") {
    const body = await req.json();
    const { name, url: machineUrl } = body as { name?: string; url?: string };

    if (!name || !machineUrl) {
      return Response.json(
        { error: "name and url are required" },
        { status: 400 }
      );
    }

    const { machineId, apiKey } = await generateMachineApiKey(orgId, name, machineUrl);
    await setOnboardingFlag(orgId, "machine_registered", true);
    await setOnboardingStep(orgId, "verify_webhook");

    return Response.json({ machineId, apiKey });
  }

  // POST /cloud/onboarding/verify-webhook
  if (req.method === "POST" && path === "/verify-webhook") {
    await setOnboardingFlag(orgId, "webhook_verified", true);
    await completeOnboarding(orgId);

    return Response.json({ success: true, completed: true });
  }

  return null;
}

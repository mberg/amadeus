// ABOUTME: Tests for the cloud server wrapper.
// ABOUTME: Verifies cloud routes are mounted before falling through to amadeus.

import { describe, test, expect, mock } from "bun:test";

// Import shared db mock
import "./mocks/amadeus-db";

// Mock amadeus modules to avoid Postgres dependency
mock.module("amadeus/config", () => ({
  initConfig: mock(() => Promise.resolve()),
  CONFIG: { dbPath: "/tmp/test.db", projectPaths: {}, triggerStates: [], agentName: "Test", disablePRCheck: true },
  REALM_CONFIG: null,
  getMachineConfig: () => ({ name: "test", heartbeat: false }),
  getServerPort: () => 0,
  getRuntimeMode: () => "standalone",
  isHubMode: () => false,
  isMachineMode: () => false,
  isStandaloneMode: () => true,
  getRouterConfig: () => null,
  getRealmByTeamKey: () => null,
  getAllWebhookSecrets: () => [],
  getSecurityConfig: () => ({ enableAgentMessaging: false, publicDashboard: false }),
  getConfigYaml: () => Promise.resolve(null),
  validateConfigYaml: () => ({ valid: true }),
  reloadConfig: () => ({ success: true }),
  getMachineUrlForProject: () => null,
}));

mock.module("amadeus/auth", () => ({
  requireAuth: mock(() => Promise.resolve({ authorized: true, context: { mode: "simple", authenticated: true, role: "admin" } })),
  getAuthInfo: () => ({ mode: "simple", authEnabled: false }),
  isBetterAuthEnabled: () => false,
}));

import { createCloudHandler } from "../src/cloud-handler";
import { handleOnboardingRoutes } from "../src/onboarding";

// Mock onboarding and org-auth at module level
mock.module("../src/db/cloud-db", () => ({
  getOnboardingState: mock(() => Promise.resolve(null)),
  setOnboardingStep: mock(() => Promise.resolve()),
  setOnboardingFlag: mock(() => Promise.resolve()),
  completeOnboarding: mock(() => Promise.resolve()),
  migrateCloud: mock(() => Promise.resolve()),
}));

describe("createCloudHandler", () => {
  test("returns a function", () => {
    const handler = createCloudHandler({
      orchestrator: null,
      machineRegistry: null,
      healthMonitor: null,
      persistence: null,
      hubHeartbeat: null,
      routerHeartbeat: null,
      idleScanner: null,
    });
    expect(typeof handler).toBe("function");
  });

  test("/health passes through to amadeus handler", async () => {
    const handler = createCloudHandler({
      orchestrator: null,
      machineRegistry: null,
      healthMonitor: null,
      persistence: null,
      hubHeartbeat: null,
      routerHeartbeat: null,
      idleScanner: null,
    });

    const res = await handler(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("/cloud/onboarding/status returns onboarding state", async () => {
    const handler = createCloudHandler({
      orchestrator: null,
      machineRegistry: null,
      healthMonitor: null,
      persistence: null,
      hubHeartbeat: null,
      routerHeartbeat: null,
      idleScanner: null,
    });

    const res = await handler(new Request("http://localhost/cloud/onboarding/status"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("currentStep");
  });

});

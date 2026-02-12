// ABOUTME: Tests for onboarding API route handlers.
// ABOUTME: Verifies each step endpoint returns correct responses.

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  mockSetSecret,
  mockSaveConfigYaml,
  mockCreateMachine,
} from "./mocks/amadeus-db";

// Mock cloud-db before import
const mockGetOnboardingState = mock(() => Promise.resolve(null));
const mockSetOnboardingStep = mock(() => Promise.resolve());
const mockSetOnboardingFlag = mock(() => Promise.resolve());
const mockCompleteOnboarding = mock(() => Promise.resolve());

mock.module("../src/db/cloud-db", () => ({
  getOnboardingState: mockGetOnboardingState,
  setOnboardingStep: mockSetOnboardingStep,
  setOnboardingFlag: mockSetOnboardingFlag,
  completeOnboarding: mockCompleteOnboarding,
}));

// api-keys uses the shared amadeus/db mock (createMachine) - no need to mock it separately

import { handleOnboardingRoutes } from "../src/onboarding";

beforeEach(() => {
  mockGetOnboardingState.mockReset();
  mockSetOnboardingStep.mockReset();
  mockSetOnboardingFlag.mockReset();
  mockCompleteOnboarding.mockReset();
  mockSetSecret.mockReset();
  mockSaveConfigYaml.mockReset();
  mockCreateMachine.mockReset();
  mockCreateMachine.mockResolvedValue({
    id: "mach_1", orgId: "org_1", name: "test", url: "http://test",
    apiKeyHash: "abc", createdAt: new Date(), lastSeen: null,
  });
});

const ORG_ID = "org_test";

function makeReq(method: string, path: string, body?: unknown): Request {
  const opts: RequestInit = { method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost${path}`, opts);
}

describe("handleOnboardingRoutes", () => {
  test("returns null for non-cloud routes", async () => {
    const req = makeReq("GET", "/status");
    const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);
    expect(res).toBeNull();
  });

  describe("GET /cloud/onboarding/status", () => {
    test("returns default state for new org", async () => {
      mockGetOnboardingState.mockResolvedValueOnce(null);

      const req = makeReq("GET", "/cloud/onboarding/status");
      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.currentStep).toBe("connect_linear");
      expect(data.completed).toBe(false);
    });

    test("returns existing state", async () => {
      mockGetOnboardingState.mockResolvedValueOnce({
        orgId: ORG_ID,
        currentStep: "register_machine",
        linearConnected: true,
        machineRegistered: false,
        webhookVerified: false,
        completedAt: null,
      });

      const req = makeReq("GET", "/cloud/onboarding/status");
      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);

      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.currentStep).toBe("register_machine");
      expect(data.linearConnected).toBe(true);
    });
  });

  describe("POST /cloud/onboarding/linear", () => {
    test("stores Linear API key and webhook secret", async () => {
      const req = makeReq("POST", "/cloud/onboarding/linear", {
        linearApiKey: "lin_api_abc",
        webhookSecret: "whsec_xyz",
        linearWorkspace: "my-workspace",
      });

      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);

      expect(res!.status).toBe(200);
      expect(mockSetSecret).toHaveBeenCalledTimes(2);
      expect(mockSetOnboardingFlag).toHaveBeenCalledWith(ORG_ID, "linear_connected", true);
    });

    test("rejects missing fields", async () => {
      const req = makeReq("POST", "/cloud/onboarding/linear", {
        linearApiKey: "lin_api_abc",
      });

      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);
      expect(res!.status).toBe(400);
    });
  });

  describe("POST /cloud/onboarding/projects", () => {
    test("saves config YAML", async () => {
      const req = makeReq("POST", "/cloud/onboarding/projects", {
        configYaml: "realms:\n  - name: default\n",
      });

      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);

      expect(res!.status).toBe(200);
      expect(mockSaveConfigYaml).toHaveBeenCalledWith(ORG_ID, "realms:\n  - name: default\n");
      expect(mockSetOnboardingStep).toHaveBeenCalledWith(ORG_ID, "register_machine");
    });
  });

  describe("POST /cloud/onboarding/machine", () => {
    test("generates API key and returns it", async () => {
      const req = makeReq("POST", "/cloud/onboarding/machine", {
        name: "my-machine",
        url: "http://machine:8080",
      });

      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);

      expect(res!.status).toBe(200);
      const data = await res!.json();
      expect(data.machineId).toBe("mach_1");
      expect(data.apiKey).toStartWith("amk_");
      expect(mockSetOnboardingFlag).toHaveBeenCalledWith(ORG_ID, "machine_registered", true);
    });

    test("rejects missing fields", async () => {
      const req = makeReq("POST", "/cloud/onboarding/machine", {});

      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);
      expect(res!.status).toBe(400);
    });
  });

  describe("POST /cloud/onboarding/verify-webhook", () => {
    test("marks webhook as verified", async () => {
      const req = makeReq("POST", "/cloud/onboarding/verify-webhook", {});

      const res = await handleOnboardingRoutes(req, new URL(req.url), ORG_ID);

      expect(res!.status).toBe(200);
      expect(mockSetOnboardingFlag).toHaveBeenCalledWith(ORG_ID, "webhook_verified", true);
      expect(mockCompleteOnboarding).toHaveBeenCalledWith(ORG_ID);
    });
  });
});

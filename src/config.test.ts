// ABOUTME: Tests for runtime mode helpers, machine configuration, and security config.
// ABOUTME: Verifies mode detection, mutual exclusivity, and publicDashboard defaults.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getRuntimeMode, getMachineConfig, isHubMode, isMachineMode, isStandaloneMode, getSecurityConfig, REALM_CONFIG } from "./config";
import type { ResolvedConfig } from "./config-schema";

describe("Runtime mode helpers", () => {
  test("getRuntimeMode returns configured mode", () => {
    // This will use the actual config, so test the helper functions work
    const mode = getRuntimeMode();
    expect(["standalone", "hub", "machine"]).toContain(mode);
  });

  test("mode helpers are mutually exclusive", () => {
    const isHub = isHubMode();
    const isMachine = isMachineMode();
    const isStandalone = isStandaloneMode();

    // Exactly one should be true
    const trueCount = [isHub, isMachine, isStandalone].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  test("mode helpers correspond to getRuntimeMode", () => {
    const mode = getRuntimeMode();

    if (mode === "hub") {
      expect(isHubMode()).toBe(true);
      expect(isMachineMode()).toBe(false);
      expect(isStandaloneMode()).toBe(false);
    } else if (mode === "machine") {
      expect(isHubMode()).toBe(false);
      expect(isMachineMode()).toBe(true);
      expect(isStandaloneMode()).toBe(false);
    } else if (mode === "standalone") {
      expect(isHubMode()).toBe(false);
      expect(isMachineMode()).toBe(false);
      expect(isStandaloneMode()).toBe(true);
    }
  });
});

describe("Machine config", () => {
  test("getMachineConfig returns config or default", () => {
    const config = getMachineConfig();
    expect(config).toHaveProperty("name");
    expect(config).toHaveProperty("heartbeat");
    expect(typeof config.name).toBe("string");
    expect(typeof config.heartbeat).toBe("boolean");
  });

  test("getMachineConfig hubUrl is optional", () => {
    const config = getMachineConfig();
    // hubUrl may or may not be present, but if present it should be a string
    if (config.hubUrl !== undefined) {
      expect(typeof config.hubUrl).toBe("string");
    }
  });
});

describe("getSecurityConfig", () => {
  test("returns security config with expected shape", () => {
    const config = getSecurityConfig();
    expect(config).toHaveProperty("publicDashboard");
    expect(config).toHaveProperty("enableAgentMessaging");
    expect(typeof config.publicDashboard).toBe("boolean");
    expect(typeof config.enableAgentMessaging).toBe("boolean");
  });

  test("in standalone mode (test env), publicDashboard is false", () => {
    // Tests run in standalone mode without Better Auth,
    // so publicDashboard should NOT be overridden to true
    if (isStandaloneMode()) {
      const config = getSecurityConfig();
      expect(config.publicDashboard).toBe(false);
    }
  });
});

describe("effectiveMode logic (runtimeMode override)", () => {
  // Tests the expression: isBetterAuthEnabled && actualMode !== "machine" ? "hub" : actualMode
  function computeEffectiveMode(actualMode: string, betterAuthEnabled: boolean): string {
    return betterAuthEnabled && actualMode !== "machine" ? "hub" : actualMode;
  }

  test("standalone + no auth = standalone", () => {
    expect(computeEffectiveMode("standalone", false)).toBe("standalone");
  });

  test("standalone + auth = hub (cloud deployment)", () => {
    expect(computeEffectiveMode("standalone", true)).toBe("hub");
  });

  test("hub + auth = hub", () => {
    expect(computeEffectiveMode("hub", true)).toBe("hub");
  });

  test("machine + no auth = machine", () => {
    expect(computeEffectiveMode("machine", false)).toBe("machine");
  });

  test("machine + auth = machine (NOT hub)", () => {
    // This is the key fix: machines with Better Auth should stay "machine"
    expect(computeEffectiveMode("machine", true)).toBe("machine");
  });
});

describe("publicDashboard override logic", () => {
  // Tests the expression: isMachineMode && !isBetterAuthEnabled => publicDashboard: true
  function shouldOverridePublicDashboard(mode: string, betterAuthEnabled: boolean): boolean {
    return mode === "machine" && !betterAuthEnabled;
  }

  test("machine + no auth => override publicDashboard to true", () => {
    expect(shouldOverridePublicDashboard("machine", false)).toBe(true);
  });

  test("machine + auth => do NOT override (auth handles access)", () => {
    expect(shouldOverridePublicDashboard("machine", true)).toBe(false);
  });

  test("standalone + no auth => do NOT override", () => {
    expect(shouldOverridePublicDashboard("standalone", false)).toBe(false);
  });

  test("hub + no auth => do NOT override", () => {
    expect(shouldOverridePublicDashboard("hub", false)).toBe(false);
  });

  test("hub + auth => do NOT override", () => {
    expect(shouldOverridePublicDashboard("hub", true)).toBe(false);
  });
});

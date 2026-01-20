// ABOUTME: Tests for runtime mode helpers and machine configuration.
// ABOUTME: Verifies mode detection and mutual exclusivity of mode helpers.

import { describe, test, expect } from "bun:test";
import { getRuntimeMode, getMachineConfig, isHubMode, isMachineMode, isStandaloneMode } from "./config";

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

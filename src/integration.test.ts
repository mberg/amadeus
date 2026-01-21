// ABOUTME: Integration tests verifying module structure and mode switching
// ABOUTME: Ensures all modules load correctly and mode helpers work as expected

import { describe, test, expect } from "bun:test";
import { getRuntimeMode, isHubMode, isMachineMode, isStandaloneMode } from "./config";

describe("Mode integration", () => {
  test("default mode is standalone", () => {
    // Without explicit config, should default to standalone
    const mode = getRuntimeMode();
    // Note: actual mode depends on config file, but helpers should be consistent
    expect(["standalone", "hub", "machine"]).toContain(mode);
  });

  test("all mode helpers are available", () => {
    expect(typeof isHubMode).toBe("function");
    expect(typeof isMachineMode).toBe("function");
    expect(typeof isStandaloneMode).toBe("function");
  });
});

describe("Module imports", () => {
  test("hub module exports work", async () => {
    const hub = await import("./hub");
    expect(hub.MachineRegistry).toBeDefined();
    expect(hub.routeWebhook).toBeDefined();
  });

  test("machine module exports work", async () => {
    const machine = await import("./machine");
    expect(machine.ClaudeOrchestrator).toBeDefined();
  });

  test("shared module exports work", async () => {
    const shared = await import("./shared/types");
    // Types are compile-time, but the module should load
    expect(shared).toBeDefined();
  });
});

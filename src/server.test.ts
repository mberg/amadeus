// ABOUTME: Tests for server mode-based initialization.
// ABOUTME: Validates that mode helpers work correctly.

import { describe, test, expect } from "bun:test";
import { isHubMode, isMachineMode, isStandaloneMode, getRuntimeMode } from "./config";

describe("Server mode initialization", () => {
  test("mode helpers work correctly", () => {
    // At least one mode should be active
    const hasActiveMode = isHubMode() || isMachineMode() || isStandaloneMode();
    expect(hasActiveMode).toBe(true);
  });

  test("getRuntimeMode returns valid mode", () => {
    const mode = getRuntimeMode();
    expect(["hub", "machine", "standalone"]).toContain(mode);
  });

  test("mode helpers are mutually exclusive", () => {
    // Exactly one mode should be active
    const activeCount = [isHubMode(), isMachineMode(), isStandaloneMode()].filter(Boolean).length;
    expect(activeCount).toBe(1);
  });
});

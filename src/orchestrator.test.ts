// ABOUTME: Tests for orchestrator port tracking used by the orphan reaper.

import { test, expect } from "bun:test";
import { ClaudeOrchestrator } from "./orchestrator";

test("getTrackedPorts returns empty set with no agents", () => {
  const orch = new ClaudeOrchestrator({
    projectPaths: {},
    triggerStates: ["Planning"],
  });
  expect(orch.getTrackedPorts()).toEqual(new Set());
});

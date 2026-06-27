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

import type { ProcessInspector } from "./process-inspector";

test("orchestrator exposes the injected process inspector for teardown", () => {
  const calls: number[] = [];
  const inspector: ProcessInspector = {
    list: async () => [],
    killTree: async (pid) => {
      calls.push(pid);
    },
  };
  const orch = new ClaudeOrchestrator({
    projectPaths: {},
    triggerStates: ["Planning"],
    processInspector: inspector,
  });
  // killTrackedAgent is a thin wrapper used by stopAgent and shutdown.
  orch.killTrackedAgent(4242);
  expect(calls).toEqual([4242]);
});

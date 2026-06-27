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

test("concurrent allocatePort() calls never return the same port", async () => {
  // Use an uncommon high port range that is very unlikely to be occupied on
  // any test machine, so isPortOccupied() returns false for all of them and
  // the only source of collisions would be the concurrency race we're fixing.
  //
  // With the OLD (broken) code: all 5 concurrent calls begin findFreePort at
  // the same nextPort (8700) before any has called inflightPorts.add(); the
  // probe sees inflightPorts.has(8700) === false for all of them, so all 5
  // return 8700 → Set size == 1 ≠ 5 → FAIL.
  //
  // With the NEW mutex: each call runs its critical section serially, so
  // each successive call sees the previous allocation in inflightPorts and
  // advances to the next free port → all 5 ports are distinct → PASS.
  const orch = new ClaudeOrchestrator({
    projectPaths: {},
    triggerStates: ["Planning"],
    agentPortStart: 8700,
    agentPortEnd: 8710,
  });
  const alloc = () => (orch as any).allocatePort() as Promise<number>;
  const ports = await Promise.all([alloc(), alloc(), alloc(), alloc(), alloc()]);
  expect(new Set(ports).size).toBe(ports.length); // all 5 must be distinct
});

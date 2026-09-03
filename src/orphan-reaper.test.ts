// ABOUTME: Tests for the conservative orphan-reap decision and orchestration.
// ABOUTME: shouldReap is table-driven; reapOrphans runs against fake deps.

import { test, expect } from "bun:test";
import { shouldReap, reapOrphans } from "./orphan-reaper";
import type { ProcessInspector, AgentApiProcess } from "./process-inspector";

const cand = (pid: number, port: number): AgentApiProcess => ({
  pid,
  port,
  command: `agentapi server claude --port ${port}`,
});

test("shouldReap spares tracked ports regardless of responsiveness", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set([8003]),
    responsive: false,
    issueTerminal: true,
  });
  expect(d).toEqual({ reap: false, reason: "tracked" });
});

test("shouldReap reaps untracked unresponsive process", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set(),
    responsive: false,
    issueTerminal: false,
  });
  expect(d).toEqual({ reap: true, reason: "unresponsive" });
});

test("shouldReap reaps untracked responsive process whose issue is terminal", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set(),
    responsive: true,
    issueTerminal: true,
  });
  expect(d).toEqual({ reap: true, reason: "issue-terminal" });
});

test("shouldReap spares untracked responsive process with active issue", () => {
  const d = shouldReap({
    candidate: cand(1, 8003),
    trackedPorts: new Set(),
    responsive: true,
    issueTerminal: false,
  });
  expect(d).toEqual({ reap: false, reason: "responsive-active" });
});

test("reapOrphans kills only the orphans that fail the gate", async () => {
  const killed: number[] = [];
  const inspector: ProcessInspector = {
    list: async () => [cand(101, 8003), cand(102, 8004), cand(103, 8005)],
    killTree: async (pid) => {
      killed.push(pid);
    },
  };
  const result = await reapOrphans({
    inspector,
    getTrackedPorts: () => new Set([8005]), // 8005 tracked -> spared
    isResponsive: async (port) => port === 8004, // 8003 dead -> reap; 8004 alive
    isIssueTerminal: async () => false, // 8004 active -> spared
    log: () => {},
  });
  expect(killed).toEqual([101]);
  expect(result.killed).toEqual([101]);
  expect(result.spared.sort()).toEqual([8004, 8005]);
});

test("reapOrphans skips out-of-range candidates and kills in-range unresponsive", async () => {
  const killed: number[] = [];
  const inspector: ProcessInspector = {
    // pid 201 is out of range (port 9999), pid 202 is in range (port 8500)
    list: async () => [cand(201, 9999), cand(202, 8500)],
    killTree: async (pid) => {
      killed.push(pid);
    },
  };
  const result = await reapOrphans({
    inspector,
    getTrackedPorts: () => new Set(),
    isResponsive: async () => false, // both unresponsive
    isIssueTerminal: async () => false,
    portRange: { start: 8001, end: 8999 },
    log: () => {},
  });
  // out-of-range port 9999 (pid 201): neither killed nor spared
  expect(result.killed).not.toContain(201);
  expect(result.spared).not.toContain(9999);
  // in-range unresponsive port 8500 (pid 202): killed
  expect(result.killed).toContain(202);
  expect(killed).toContain(202);
});

test("reapOrphans continues past a killTree failure", async () => {
  const killed: number[] = [];
  const inspector: ProcessInspector = {
    list: async () => [cand(101, 8003), cand(102, 8006)],
    killTree: async (pid) => {
      if (pid === 101) throw new Error("boom");
      killed.push(pid);
    },
  };
  const result = await reapOrphans({
    inspector,
    getTrackedPorts: () => new Set(),
    isResponsive: async () => false,
    isIssueTerminal: async () => false,
    log: () => {},
  });
  expect(killed).toEqual([102]);
  expect(result.killed).toEqual([102]);
});

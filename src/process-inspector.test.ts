// ABOUTME: Tests for parsing `ps` output into agentapi process records.
// ABOUTME: Killing is exercised via the injectable ProcessInspector interface elsewhere.

import { test, expect } from "bun:test";
import { parseAgentApiProcesses } from "./process-inspector";

const PS = [
  "  101 agentapi server claude --port 8003 -- --dangerously-skip-permissions",
  "  102 agentapi server codex --port 8004 -- --dangerously-bypass-approvals-and-sandbox",
  "  103 /bin/zsh -c something unrelated",
  "  104 claude --dangerously-skip-permissions",
  "  105 agentapi server claude --port notaport",
].join("\n");

test("parses pid and port from agentapi server lines", () => {
  const procs = parseAgentApiProcesses(PS);
  expect(procs).toEqual([
    { pid: 101, port: 8003, command: "agentapi server claude --port 8003 -- --dangerously-skip-permissions" },
    { pid: 102, port: 8004, command: "agentapi server codex --port 8004 -- --dangerously-bypass-approvals-and-sandbox" },
  ]);
});

test("ignores non-agentapi lines and lines without a numeric port", () => {
  const procs = parseAgentApiProcesses(PS);
  expect(procs.map((p) => p.pid)).not.toContain(103);
  expect(procs.map((p) => p.pid)).not.toContain(104);
  expect(procs.map((p) => p.pid)).not.toContain(105);
});

test("returns empty array for empty input", () => {
  expect(parseAgentApiProcesses("")).toEqual([]);
});

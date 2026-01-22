// ABOUTME: Tests for the idle agent scanner.
// ABOUTME: Verifies detection and termination of idle agents.

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { IdleScanner } from "./idle-scanner";
import { MachineRegistry } from "./registry";

describe("IdleScanner", () => {
  let registry: MachineRegistry;
  let stopAgent: ReturnType<typeof mock>;
  let scanner: IdleScanner;

  beforeEach(() => {
    registry = new MachineRegistry();
    stopAgent = mock(() => Promise.resolve());
    scanner = new IdleScanner(
      {
        enabled: true,
        timeoutMinutes: 15,
        idleStates: ["Needs Feedback"],
        scanIntervalSeconds: 60,
      },
      registry,
      stopAgent
    );
  });

  test("scan terminates agents idle longer than timeout", async () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "Needs Feedback" } as any,
    ]);

    // Backdate idle start time to 20 minutes ago
    const info = registry.getAgentIdleInfo("Frank", "agent-1");
    if (info) {
      info.idleStartTime = new Date(Date.now() - 20 * 60 * 1000);
    }

    await scanner.scan();

    expect(stopAgent).toHaveBeenCalledTimes(1);
    expect(stopAgent).toHaveBeenCalledWith("http://frank.local:5678", "agent-1");
  });

  test("scan does not terminate agents below timeout", async () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "Needs Feedback" } as any,
    ]);

    // Idle for only 5 minutes (below 15 min threshold)
    const info = registry.getAgentIdleInfo("Frank", "agent-1");
    if (info) {
      info.idleStartTime = new Date(Date.now() - 5 * 60 * 1000);
    }

    await scanner.scan();

    expect(stopAgent).not.toHaveBeenCalled();
  });

  test("scan ignores agents not in idle states", async () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "In Progress" } as any,
    ]);

    await scanner.scan();

    expect(stopAgent).not.toHaveBeenCalled();
  });
});

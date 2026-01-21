// ABOUTME: Unit tests for the machine registry.
// ABOUTME: Verifies registration, status updates, and config loading.

import { describe, test, expect, beforeEach } from "bun:test";
import { MachineRegistry } from "./registry";

describe("MachineRegistry", () => {
  let registry: MachineRegistry;

  beforeEach(() => {
    registry = new MachineRegistry();
  });

  test("registers a new machine", () => {
    registry.register("Frank", "http://frank.local:5678");
    const machine = registry.get("Frank");
    expect(machine).toBeDefined();
    expect(machine?.name).toBe("Frank");
    expect(machine?.url).toBe("http://frank.local:5678");
    expect(machine?.status).toBe("unknown");
  });

  test("updates existing machine on re-register", () => {
    registry.register("Frank", "http://old.url");
    registry.register("Frank", "http://new.url");
    const machine = registry.get("Frank");
    expect(machine?.url).toBe("http://new.url");
  });

  test("getAll returns all machines", () => {
    registry.register("Frank", "http://frank.local:5678");
    registry.register("Bob", "http://bob.local:5678");
    const all = registry.getAll();
    expect(all.length).toBe(2);
    expect(all.map(m => m.name).sort()).toEqual(["Bob", "Frank"]);
  });

  test("updateStatus updates machine health", () => {
    registry.register("Frank", "http://frank.local:5678");
    const mockAgents = [
      { key: "agent-1", status: "working" },
      { key: "agent-2", status: "idle" },
      { key: "agent-3", status: "working" },
    ] as any[];
    registry.updateStatus("Frank", "healthy", mockAgents);
    const machine = registry.get("Frank");
    expect(machine?.status).toBe("healthy");
    expect(machine?.agentCount).toBe(3);
    expect(machine?.agents).toHaveLength(3);
  });

  test("getCachedStatus returns machines with dormant detection", () => {
    registry.register("Frank", "http://frank.local:5678");

    // Machine with recent heartbeat
    registry.updateStatus("Frank", "healthy", []);
    let cached = registry.getCachedStatus();
    expect(cached[0].status).toBe("healthy");

    // Manually set old heartbeat to test dormant detection
    const machine = registry.get("Frank");
    if (machine) {
      machine.lastHeartbeat = new Date(Date.now() - 130_000); // 2+ minutes ago
    }
    cached = registry.getCachedStatus();
    expect(cached[0].status).toBe("dormant");
  });

  test("loadFromConfig registers multiple machines", () => {
    registry.loadFromConfig([
      { name: "Frank", url: "http://frank.local:5678" },
      { name: "Bob", url: "http://bob.local:5678" },
    ]);
    expect(registry.getAll().length).toBe(2);
  });
});

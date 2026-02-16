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

  test("tracks agent idle start time", () => {
    registry.register("Frank", "http://frank.local:5678");

    // First heartbeat with idle state
    const agents = [{ key: "agent-1", linearState: "Needs Feedback" }] as any[];
    registry.updateStatus("Frank", "healthy", agents);

    const idleInfo = registry.getAgentIdleInfo("Frank", "agent-1");
    expect(idleInfo?.idleStartTime).toBeDefined();
    expect(idleInfo?.linearState).toBe("Needs Feedback");
  });

  test("clears idle time when agent leaves idle state", () => {
    registry.register("Frank", "http://frank.local:5678");

    // Start idle
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "Needs Feedback" } as any,
    ]);
    expect(registry.getAgentIdleInfo("Frank", "agent-1")?.idleStartTime).toBeDefined();

    // Leave idle state
    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "In Progress" } as any,
    ]);
    expect(registry.getAgentIdleInfo("Frank", "agent-1")?.idleStartTime).toBeUndefined();
  });

  test("queueStopCommand and drainStopCommands", () => {
    registry.register("Frank", "http://frank.local:5678");

    registry.queueStopCommand("Frank", "agent-1", "idle");
    registry.queueStopCommand("Frank", "agent-2", "stopped");

    const commands = registry.drainStopCommands("Frank");
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual({ agentKey: "agent-1", reason: "idle" });
    expect(commands[1]).toEqual({ agentKey: "agent-2", reason: "stopped" });

    // Drain again should be empty
    const empty = registry.drainStopCommands("Frank");
    expect(empty).toHaveLength(0);
  });

  test("drainStopCommands returns empty for unknown machine", () => {
    const commands = registry.drainStopCommands("Unknown");
    expect(commands).toHaveLength(0);
  });

  test("getIdleAgents returns agents idle longer than threshold", () => {
    registry.register("Frank", "http://frank.local:5678");

    registry.updateStatus("Frank", "healthy", [
      { key: "agent-1", linearState: "Needs Feedback" } as any,
    ]);

    // Manually backdate idle start time
    const info = registry.getAgentIdleInfo("Frank", "agent-1");
    if (info) {
      info.idleStartTime = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
    }

    const idleAgents = registry.getIdleAgents(["Needs Feedback"], 15 * 60 * 1000);
    expect(idleAgents.length).toBe(1);
    expect(idleAgents[0].agentKey).toBe("agent-1");
    expect(idleAgents[0].machineName).toBe("Frank");
  });
});

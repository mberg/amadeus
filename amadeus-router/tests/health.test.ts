// ABOUTME: Tests for health monitoring that tracks machine heartbeats.
// ABOUTME: Tests heartbeat storage, health checking, and stale detection.

import { describe, test, expect, beforeEach } from "bun:test";
import {
  HealthMonitor,
  type HeartbeatStore,
  HEALTH_THRESHOLD_MS,
} from "../src/health";

class MockHeartbeatStore implements HeartbeatStore {
  private data: Map<string, number> = new Map();

  async get(key: string): Promise<number | null> {
    return this.data.get(key) ?? null;
  }

  async put(key: string, timestamp: number): Promise<void> {
    this.data.set(key, timestamp);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(): Promise<Array<{ machine: string; timestamp: number }>> {
    return Array.from(this.data.entries()).map(([machine, timestamp]) => ({
      machine,
      timestamp,
    }));
  }
}

describe("HealthMonitor", () => {
  let store: MockHeartbeatStore;
  let monitor: HealthMonitor;
  let now: number;

  beforeEach(() => {
    store = new MockHeartbeatStore();
    monitor = new HealthMonitor(store);
    now = Date.now();
  });

  describe("recordHeartbeat", () => {
    test("stores heartbeat timestamp for machine", async () => {
      await monitor.recordHeartbeat("macbook");

      const timestamp = await store.get("macbook");
      expect(timestamp).not.toBeNull();
      expect(timestamp).toBeGreaterThan(now - 1000);
    });

    test("updates existing heartbeat", async () => {
      await monitor.recordHeartbeat("macbook");
      const first = await store.get("macbook");

      // Simulate time passing
      await new Promise((r) => setTimeout(r, 10));

      await monitor.recordHeartbeat("macbook");
      const second = await store.get("macbook");

      expect(second).toBeGreaterThan(first!);
    });
  });

  describe("isHealthy", () => {
    test("returns true for recent heartbeat", async () => {
      await monitor.recordHeartbeat("macbook");

      const healthy = await monitor.isHealthy("macbook");

      expect(healthy).toBe(true);
    });

    test("returns false for stale heartbeat", async () => {
      // Store a timestamp older than threshold
      const staleTimestamp = now - HEALTH_THRESHOLD_MS - 1000;
      await store.put("macbook", staleTimestamp);

      const healthy = await monitor.isHealthy("macbook");

      expect(healthy).toBe(false);
    });

    test("returns false for unknown machine", async () => {
      const healthy = await monitor.isHealthy("unknown-machine");

      expect(healthy).toBe(false);
    });
  });

  describe("getLastHeartbeat", () => {
    test("returns timestamp for known machine", async () => {
      await monitor.recordHeartbeat("macbook");

      const timestamp = await monitor.getLastHeartbeat("macbook");

      expect(timestamp).not.toBeNull();
      expect(timestamp).toBeGreaterThan(now - 1000);
    });

    test("returns null for unknown machine", async () => {
      const timestamp = await monitor.getLastHeartbeat("unknown");

      expect(timestamp).toBeNull();
    });
  });

  describe("getAllStatus", () => {
    test("returns status for all machines", async () => {
      await monitor.recordHeartbeat("macbook");
      await monitor.recordHeartbeat("gpu-beast");

      const status = await monitor.getAllStatus();

      expect(status.length).toBe(2);
      expect(status.find((s) => s.machine === "macbook")).toBeDefined();
      expect(status.find((s) => s.machine === "gpu-beast")).toBeDefined();
    });

    test("includes health status in results", async () => {
      await monitor.recordHeartbeat("macbook");

      // Store stale heartbeat
      const staleTimestamp = now - HEALTH_THRESHOLD_MS - 1000;
      await store.put("gpu-beast", staleTimestamp);

      const status = await monitor.getAllStatus();

      const macbook = status.find((s) => s.machine === "macbook");
      const gpuBeast = status.find((s) => s.machine === "gpu-beast");

      expect(macbook?.healthy).toBe(true);
      expect(gpuBeast?.healthy).toBe(false);
    });

    test("returns empty array when no machines", async () => {
      const status = await monitor.getAllStatus();

      expect(status).toEqual([]);
    });
  });

  describe("removeMachine", () => {
    test("removes machine from store", async () => {
      await monitor.recordHeartbeat("macbook");
      expect(await store.get("macbook")).not.toBeNull();

      await monitor.removeMachine("macbook");

      expect(await store.get("macbook")).toBeNull();
    });

    test("handles removing non-existent machine", async () => {
      // Should not throw
      await monitor.removeMachine("unknown");
    });
  });
});

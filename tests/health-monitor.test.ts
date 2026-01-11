// ABOUTME: Tests for the health monitor that checks agent liveness.
// ABOUTME: Verifies health checks, conversation snapshotting, and death detection.

import { describe, expect, it, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { HealthMonitor, type HealthMonitorConfig } from "../src/health-monitor";
import { AgentPersistence } from "../src/persistence";
import { unlink } from "node:fs/promises";

describe("HealthMonitor", () => {
  let persistence: AgentPersistence;
  let monitor: HealthMonitor;
  const testDbPath = "/tmp/test-health-monitor.db";
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    try {
      await unlink(testDbPath);
    } catch {
      // File doesn't exist
    }
    persistence = new AgentPersistence(testDbPath);
  });

  afterEach(async () => {
    // Restore original fetch
    globalThis.fetch = originalFetch;

    if (monitor) {
      monitor.stop();
    }
    persistence.close();
    try {
      await unlink(testDbPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    it("creates monitor with default config", () => {
      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      expect(monitor).toBeDefined();
    });

    it("accepts custom check interval", () => {
      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
        checkIntervalMs: 5000,
      });

      expect(monitor.getCheckInterval()).toBe(5000);
    });

    it("accepts custom timeout", () => {
      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
        timeoutMs: 10000,
      });

      expect(monitor.getTimeout()).toBe(10000);
    });
  });

  describe("start/stop", () => {
    it("starts and stops monitoring", async () => {
      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
        checkIntervalMs: 100,
      });

      expect(monitor.isRunning()).toBe(false);

      monitor.start();
      expect(monitor.isRunning()).toBe(true);

      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });

    it("can be started multiple times safely", () => {
      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      monitor.start();
      monitor.start(); // Should not throw

      expect(monitor.isRunning()).toBe(true);
    });

    it("can be stopped multiple times safely", () => {
      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      monitor.start();
      monitor.stop();
      monitor.stop(); // Should not throw

      expect(monitor.isRunning()).toBe(false);
    });
  });

  describe("checkAgentHealth", () => {
    it("returns healthy for responsive agent", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ status: "stable" }), { status: 200 }))
      );
      globalThis.fetch = mockFetch as typeof fetch;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      const result = await monitor.checkAgentHealth(8001);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe("stable");
    });

    it("returns unhealthy for unresponsive agent", async () => {
      const mockFetch = mock(() => Promise.reject(new Error("Connection refused")));
      globalThis.fetch = mockFetch as typeof fetch;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      const result = await monitor.checkAgentHealth(8001);
      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns unhealthy for 500 response", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response("Internal Server Error", { status: 500 }))
      );
      globalThis.fetch = mockFetch as typeof fetch;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      const result = await monitor.checkAgentHealth(8001);
      expect(result.healthy).toBe(false);
    });
  });

  describe("fetchConversation", () => {
    it("returns messages from agent", async () => {
      const mockMessages = {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
      };

      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockMessages), { status: 200 }))
      );
      globalThis.fetch = mockFetch as typeof fetch;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      const result = await monitor.fetchConversation(8001);
      expect(result).toEqual(mockMessages.messages);
    });

    it("returns empty array on error", async () => {
      const mockFetch = mock(() => Promise.reject(new Error("Connection refused")));
      globalThis.fetch = mockFetch as typeof fetch;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      const result = await monitor.fetchConversation(8001);
      expect(result).toEqual([]);
    });
  });

  describe("saveAgentSnapshot", () => {
    it("saves agent state and conversation to persistence", async () => {
      const mockMessages = {
        messages: [{ role: "user", content: "Test message" }],
      };

      // saveAgentSnapshot only calls /messages, not /status
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockMessages), { status: 200 }))
      );
      globalThis.fetch = mockFetch as typeof fetch;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [],
        onAgentUnresponsive: () => {},
      });

      await monitor.saveAgentSnapshot({
        key: "TEST-issue-123",
        issueId: "issue-123",
        issueIdentifier: "TEST-1",
        issueTitle: "Test Issue",
        projectPath: "/tmp/test",
        port: 8001,
        linearState: "Building",
      });

      const saved = persistence.getAgentByIssueId("issue-123");
      expect(saved).not.toBeNull();
      expect(saved!.issueIdentifier).toBe("TEST-1");
      expect(saved!.conversationSnapshot).toEqual(mockMessages.messages);
    });
  });

  describe("onAgentUnresponsive callback", () => {
    it("calls callback when agent becomes unresponsive", async () => {
      const mockFetch = mock(() => Promise.reject(new Error("Connection refused")));
      globalThis.fetch = mockFetch as typeof fetch;

      let callbackCalled = false;
      let callbackIssueId: string | undefined;

      monitor = new HealthMonitor({
        persistence,
        getAgents: () => [
          {
            key: "TEST-issue-123",
            issueId: "issue-123",
            issueIdentifier: "TEST-1",
            issueTitle: "Test",
            port: 8001,
            projectPath: "/tmp/test",
          },
        ],
        onAgentUnresponsive: (info) => {
          callbackCalled = true;
          callbackIssueId = info.issueId;
        },
      });

      await monitor.runHealthCheck();

      expect(callbackCalled).toBe(true);
      expect(callbackIssueId).toBe("issue-123");
    });
  });
});

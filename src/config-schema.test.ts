// ABOUTME: Tests for Amadeus configuration schema validation.
// ABOUTME: Verifies RuntimeModeSchema, MachineConfigSchema, and StaticMachineSchema behavior.

import { describe, test, expect } from "bun:test";
import { RuntimeModeSchema, MachineConfigSchema, StaticMachineSchema, AmadeusConfigSchema, GlobalConfigSchema } from "./config-schema";

describe("RuntimeModeSchema", () => {
  test("accepts 'standalone' mode", () => {
    expect(RuntimeModeSchema.parse("standalone")).toBe("standalone");
  });

  test("accepts 'hub' mode", () => {
    expect(RuntimeModeSchema.parse("hub")).toBe("hub");
  });

  test("accepts 'machine' mode", () => {
    expect(RuntimeModeSchema.parse("machine")).toBe("machine");
  });

  test("defaults to 'standalone'", () => {
    expect(RuntimeModeSchema.parse(undefined)).toBe("standalone");
  });

  test("rejects invalid modes", () => {
    expect(() => RuntimeModeSchema.parse("invalid")).toThrow();
  });
});

describe("MachineConfigSchema", () => {
  test("validates machine config with name", () => {
    const result = MachineConfigSchema.parse({
      name: "Frank",
      heartbeat: true,
    });
    expect(result.name).toBe("Frank");
    expect(result.heartbeat).toBe(true);
  });

  test("heartbeat defaults to false", () => {
    const result = MachineConfigSchema.parse({ name: "Bob" });
    expect(result.heartbeat).toBe(false);
  });

  test("hub URL is optional", () => {
    const result = MachineConfigSchema.parse({ name: "Local" });
    expect(result.hubUrl).toBeUndefined();
  });

  test("validates hub URL format when provided", () => {
    const result = MachineConfigSchema.parse({
      name: "Remote",
      hubUrl: "https://hub.example.com",
    });
    expect(result.hubUrl).toBe("https://hub.example.com");
  });

  test("rejects invalid hub URL", () => {
    expect(() =>
      MachineConfigSchema.parse({
        name: "Invalid",
        hubUrl: "not-a-url",
      })
    ).toThrow();
  });

  test("requires non-empty name", () => {
    expect(() => MachineConfigSchema.parse({ name: "" })).toThrow();
  });

  test("token is optional", () => {
    const result = MachineConfigSchema.parse({ name: "NoToken" });
    expect(result.token).toBeUndefined();
  });

  test("accepts token when provided", () => {
    const result = MachineConfigSchema.parse({
      name: "Authenticated",
      token: "secret-token-123",
    });
    expect(result.token).toBe("secret-token-123");
  });
});

describe("StaticMachineSchema", () => {
  test("validates static machine with name and url", () => {
    const result = StaticMachineSchema.parse({
      name: "Frank",
      url: "https://frank.example.com",
    });
    expect(result.name).toBe("Frank");
    expect(result.url).toBe("https://frank.example.com");
  });

  test("requires non-empty name", () => {
    expect(() => StaticMachineSchema.parse({ name: "", url: "https://example.com" })).toThrow();
  });

  test("requires valid URL", () => {
    expect(() => StaticMachineSchema.parse({ name: "Test", url: "not-a-url" })).toThrow();
  });
});

test("GlobalConfig provides orphan-cleanup defaults", () => {
  const cfg = GlobalConfigSchema.parse({});
  expect(cfg.agentPortStart).toBe(8001);
  expect(cfg.agentPortEnd).toBe(8999);
  expect(cfg.orphanReapIntervalMs).toBe(30000);
});

test("GlobalConfig accepts custom orphan-cleanup values", () => {
  const cfg = GlobalConfigSchema.parse({
    agentPortStart: 9000,
    agentPortEnd: 9100,
    orphanReapIntervalMs: 15000,
  });
  expect(cfg.agentPortStart).toBe(9000);
  expect(cfg.agentPortEnd).toBe(9100);
  expect(cfg.orphanReapIntervalMs).toBe(15000);
});

// ABOUTME: Tests for machine API key generation and validation.
// ABOUTME: Verifies key format, hashing, and round-trip authentication.

import { describe, test, expect, beforeEach } from "bun:test";
import {
  mockCreateMachine,
  mockAuthenticateMachine,
} from "./mocks/amadeus-db";

import { generateMachineApiKey, verifyMachineApiKey } from "../src/api-keys";

beforeEach(() => {
  mockCreateMachine.mockReset();
  mockCreateMachine.mockResolvedValue({
    id: "mach_123", orgId: "org_1", name: "test", url: "http://test",
    apiKeyHash: "abc", createdAt: new Date(), lastSeen: null,
  });
  mockAuthenticateMachine.mockReset();
});

describe("generateMachineApiKey", () => {
  test("returns key with amk_ prefix", async () => {
    const result = await generateMachineApiKey("org_1", "my-machine", "http://machine:8080");
    expect(result.apiKey).toStartWith("amk_");
  });

  test("returns a machineId from db", async () => {
    const result = await generateMachineApiKey("org_1", "my-machine", "http://machine:8080");
    expect(result.machineId).toBe("mach_123");
  });

  test("calls createMachine with hashed key", async () => {
    const result = await generateMachineApiKey("org_1", "my-machine", "http://machine:8080");

    expect(mockCreateMachine).toHaveBeenCalledTimes(1);
    const [orgId, name, url, hash] = mockCreateMachine.mock.calls[0];
    expect(orgId).toBe("org_1");
    expect(name).toBe("my-machine");
    expect(url).toBe("http://machine:8080");
    // Hash should be a 64-char hex string (SHA-256)
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Hash should NOT be the raw key
    expect(hash).not.toBe(result.apiKey);
  });

  test("generates unique keys on each call", async () => {
    const r1 = await generateMachineApiKey("org_1", "m1", "http://m1");
    const r2 = await generateMachineApiKey("org_1", "m2", "http://m2");
    expect(r1.apiKey).not.toBe(r2.apiKey);
  });
});

describe("verifyMachineApiKey", () => {
  test("returns null for invalid key", async () => {
    mockAuthenticateMachine.mockResolvedValueOnce(null);
    const result = await verifyMachineApiKey("amk_invalid");
    expect(result).toBeNull();
  });

  test("hashes key and calls authenticateMachine", async () => {
    mockAuthenticateMachine.mockResolvedValueOnce({
      orgId: "org_1", machineName: "my-machine", machineId: "mach_123",
    });

    const result = await verifyMachineApiKey("amk_somekey");
    expect(result).toEqual({
      orgId: "org_1", machineName: "my-machine", machineId: "mach_123",
    });
    expect(mockAuthenticateMachine).toHaveBeenCalledTimes(1);
    // Should pass a SHA-256 hash
    const [hash] = mockAuthenticateMachine.mock.calls[0];
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("generated key verifies through round-trip", async () => {
    // Generate a key
    let capturedHash = "";
    mockCreateMachine.mockImplementationOnce(async (orgId: string, name: string, url: string, hash: string) => {
      capturedHash = hash;
      return { id: "mach_456", orgId, name, url, apiKeyHash: hash, createdAt: new Date(), lastSeen: null };
    });

    const { apiKey } = await generateMachineApiKey("org_1", "roundtrip", "http://rt");

    // Mock authenticateMachine to return match when hash matches
    mockAuthenticateMachine.mockImplementationOnce(async (hash: string) => {
      if (hash === capturedHash) {
        return { orgId: "org_1", machineName: "roundtrip", machineId: "mach_456" };
      }
      return null;
    });

    const result = await verifyMachineApiKey(apiKey);
    expect(result).not.toBeNull();
    expect(result!.machineName).toBe("roundtrip");
  });
});

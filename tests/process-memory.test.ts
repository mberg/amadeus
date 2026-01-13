// ABOUTME: Tests for the process memory utility.
// ABOUTME: Verifies memory fetching for processes on Mac.

import { describe, expect, it } from "bun:test";
import { getProcessMemoryMB } from "../src/process-memory";

describe("getProcessMemoryMB", () => {
  it("returns memory for current process", async () => {
    // Get memory for the current bun test process
    const pid = process.pid;
    const memoryMB = await getProcessMemoryMB(pid);

    // Current process should have some memory usage
    expect(memoryMB).toBeGreaterThan(0);
    // And less than 10 GB (sanity check)
    expect(memoryMB).toBeLessThan(10000);
  });

  it("returns undefined for non-existent process", async () => {
    // Use an impossibly high PID that shouldn't exist
    const memoryMB = await getProcessMemoryMB(9999999);
    expect(memoryMB).toBeUndefined();
  });

  it("returns undefined when pid is undefined", async () => {
    const memoryMB = await getProcessMemoryMB(undefined);
    expect(memoryMB).toBeUndefined();
  });
});

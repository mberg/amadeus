// ABOUTME: Tests for GitHub PR merge detection functionality.
// ABOUTME: Tests the checkPRMerged function that uses gh CLI.

import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { checkPRMerged, type PRStatus } from "../src/github";
import * as github from "../src/github";

describe("checkPRMerged", () => {
  it("returns merged=true when PR is merged", async () => {
    const mockExecutor = mock(() =>
      Promise.resolve({ merged: true, state: "MERGED" } as PRStatus)
    );

    const result = await checkPRMerged("TEST-1", "/tmp/project", mockExecutor);

    expect(result.merged).toBe(true);
    expect(result.state).toBe("MERGED");
    expect(mockExecutor).toHaveBeenCalledWith("TEST-1", "/tmp/project");
  });

  it("returns merged=false when PR is open", async () => {
    const mockExecutor = mock(() =>
      Promise.resolve({ merged: false, state: "OPEN" } as PRStatus)
    );

    const result = await checkPRMerged("TEST-2", "/tmp/project", mockExecutor);

    expect(result.merged).toBe(false);
    expect(result.state).toBe("OPEN");
  });

  it("returns merged=false when PR is closed without merging", async () => {
    const mockExecutor = mock(() =>
      Promise.resolve({ merged: false, state: "CLOSED" } as PRStatus)
    );

    const result = await checkPRMerged("TEST-3", "/tmp/project", mockExecutor);

    expect(result.merged).toBe(false);
    expect(result.state).toBe("CLOSED");
  });

  it("returns error state when no PR exists", async () => {
    const mockExecutor = mock(() =>
      Promise.resolve({ merged: false, state: "NO_PR", error: "no pull requests found" } as PRStatus)
    );

    const result = await checkPRMerged("TEST-4", "/tmp/project", mockExecutor);

    expect(result.merged).toBe(false);
    expect(result.state).toBe("NO_PR");
    expect(result.error).toBeDefined();
  });
});

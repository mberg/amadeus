// ABOUTME: Tests for Linear user identity fetching.
// ABOUTME: Validates error handling for invalid and empty tokens against the real API.

import { describe, test, expect } from "bun:test";
import { fetchLinearUserId } from "./linear";

describe("fetchLinearUserId", () => {
  test("returns null for invalid token", async () => {
    const result = await fetchLinearUserId("invalid-token-xxx");
    expect(result).toBeNull();
  });

  test("returns null for empty token", async () => {
    const result = await fetchLinearUserId("");
    expect(result).toBeNull();
  });
});

// ABOUTME: Test file created for ONA-2071 to verify Amadeus workflow.
// ABOUTME: Tests a simple greeting function using the name "roy".

import { describe, expect, it } from "bun:test";

function greet(name: string): string {
  return `Hello, ${name}!`;
}

describe("greet", () => {
  it("greets roy correctly", () => {
    expect(greet("roy")).toBe("Hello, roy!");
  });

  it("returns a greeting with the provided name", () => {
    expect(greet("roy")).toContain("roy");
  });
});

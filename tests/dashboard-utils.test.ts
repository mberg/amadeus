// ABOUTME: Tests for dashboard utility functions.
// ABOUTME: Verifies state variant matching for Linear issue states.

import { describe, expect, it } from "bun:test";
import { getStateVariant } from "../src/dashboard/lib/utils";

describe("getStateVariant", () => {
  it("returns 'default' for undefined state", () => {
    expect(getStateVariant(undefined)).toBe("default");
  });

  it("returns 'planning' for 'Planning' state", () => {
    expect(getStateVariant("Planning")).toBe("planning");
  });

  it("returns 'planning' for 'Scoping' state", () => {
    expect(getStateVariant("Scoping")).toBe("planning");
  });

  it("returns 'building' for 'Building' state", () => {
    expect(getStateVariant("Building")).toBe("building");
  });

  it("returns 'building' for 'Ready to Build' state", () => {
    expect(getStateVariant("Ready to Build")).toBe("building");
  });

  it("returns 'feedback' for 'Feedback Needed' state", () => {
    expect(getStateVariant("Feedback Needed")).toBe("feedback");
  });

  it("returns 'review' for 'Review' state", () => {
    expect(getStateVariant("Review")).toBe("review");
  });

  it("returns 'done' for 'Done' state", () => {
    expect(getStateVariant("Done")).toBe("done");
  });

  it("returns 'default' for unknown state", () => {
    expect(getStateVariant("Unknown State")).toBe("default");
  });

  it("is case-insensitive", () => {
    expect(getStateVariant("PLANNING")).toBe("planning");
    expect(getStateVariant("building")).toBe("building");
    expect(getStateVariant("FEEDBACK NEEDED")).toBe("feedback");
  });
});

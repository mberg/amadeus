// ABOUTME: Tests for Linear webhook HMAC signature verification.
// ABOUTME: Ensures we correctly validate incoming webhook authenticity.

import { describe, expect, it } from "bun:test";
import { verifyLinearSignature } from "../src/signature";

describe("verifyLinearSignature", () => {
  const secret = "test-secret";
  const payload = '{"action":"update","type":"Issue"}';

  it("returns true for valid signature", async () => {
    // Pre-computed HMAC-SHA256 of payload with secret
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const validSignature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifyLinearSignature(payload, validSignature, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const result = await verifyLinearSignature(payload, "invalid-sig", secret);
    expect(result).toBe(false);
  });

  it("returns false for null signature", async () => {
    const result = await verifyLinearSignature(payload, null, secret);
    expect(result).toBe(false);
  });

  it("returns false for empty secret", async () => {
    const result = await verifyLinearSignature(payload, "some-sig", "");
    expect(result).toBe(false);
  });
});

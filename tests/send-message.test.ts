// ABOUTME: Tests for the sendMessage utility function.
// ABOUTME: Verifies message sending to agents via the /trigger endpoint.

import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

// We'll test the sendMessage function once implemented
describe("sendMessage", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts message to /trigger endpoint with correct payload", async () => {
    let capturedUrl: string | undefined;
    let capturedOptions: RequestInit | undefined;

    globalThis.fetch = mock(async (url: string | URL | Request, options?: RequestInit) => {
      capturedUrl = url.toString();
      capturedOptions = options;
      return new Response("Sent", { status: 200 });
    }) as typeof fetch;

    // Import after mocking fetch
    const { sendMessage } = await import("../src/dashboard/lib/send-message");

    await sendMessage("ONA-123", "Hello agent");

    expect(capturedUrl).toBe("/trigger");
    expect(capturedOptions?.method).toBe("POST");
    expect(capturedOptions?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(JSON.parse(capturedOptions?.body as string)).toEqual({
      agentKey: "ONA-123",
      message: "Hello agent",
    });
  });

  it("returns success true when request succeeds", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Sent", { status: 200 });
    }) as typeof fetch;

    const { sendMessage } = await import("../src/dashboard/lib/send-message");
    const result = await sendMessage("ONA-123", "Hello");

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns success false with error message on failure", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Bad Request", { status: 400 });
    }) as typeof fetch;

    const { sendMessage } = await import("../src/dashboard/lib/send-message");
    const result = await sendMessage("ONA-123", "Hello");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to send message");
  });

  it("returns success false with error message on network error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as typeof fetch;

    const { sendMessage } = await import("../src/dashboard/lib/send-message");
    const result = await sendMessage("ONA-123", "Hello");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  it("trims whitespace from message", async () => {
    let capturedBody: string | undefined;

    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return new Response("Sent", { status: 200 });
    }) as typeof fetch;

    const { sendMessage } = await import("../src/dashboard/lib/send-message");
    await sendMessage("ONA-123", "  Hello with spaces  ");

    expect(JSON.parse(capturedBody!).message).toBe("Hello with spaces");
  });

  it("returns error for empty message after trimming", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Sent", { status: 200 });
    }) as typeof fetch;

    const { sendMessage } = await import("../src/dashboard/lib/send-message");
    const result = await sendMessage("ONA-123", "   ");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Message cannot be empty");
  });
});

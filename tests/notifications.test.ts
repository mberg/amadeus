// ABOUTME: Tests for email notification module.
// ABOUTME: Verifies notification sending via Resend API and state transition detection.

import { describe, expect, it, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  sendNotification,
  notifyFeedbackNeeded,
  notifyReviewReady,
  shouldNotify,
} from "../src/notifications";

describe("notifications", () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "test-id" }), { status: 200 }))
    );
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("sendNotification", () => {
    it("calls Resend API with correct payload", async () => {
      await sendNotification({
        to: "test@example.com",
        subject: "Test Subject",
        body: "Test body",
        apiKey: "re_test_key",
        from: "sender@example.com",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe("Bearer re_test_key");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.to).toEqual(["test@example.com"]);
      expect(body.from).toBe("sender@example.com");
      expect(body.subject).toBe("Test Subject");
      expect(body.text).toBe("Test body");
    });

    it("returns success result on 200 response", async () => {
      const result = await sendNotification({
        to: "test@example.com",
        subject: "Test",
        body: "Body",
        apiKey: "re_test_key",
        from: "sender@example.com",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("test-id");
    });

    it("returns failure result on API error", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 })
        )
      );

      const result = await sendNotification({
        to: "test@example.com",
        subject: "Test",
        body: "Body",
        apiKey: "bad_key",
        from: "sender@example.com",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("returns failure result on network error", async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

      const result = await sendNotification({
        to: "test@example.com",
        subject: "Test",
        body: "Body",
        apiKey: "re_test_key",
        from: "sender@example.com",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("skips sending when API key is missing", async () => {
      const result = await sendNotification({
        to: "test@example.com",
        subject: "Test",
        body: "Body",
        apiKey: "",
        from: "sender@example.com",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
    });

    it("skips sending when recipient is missing", async () => {
      const result = await sendNotification({
        to: "",
        subject: "Test",
        body: "Body",
        apiKey: "re_test_key",
        from: "sender@example.com",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("recipient");
    });
  });

  describe("notifyFeedbackNeeded", () => {
    it("sends notification with correct format", async () => {
      await notifyFeedbackNeeded({
        issueIdentifier: "ONA-123",
        issueTitle: "Fix the bug",
        to: "user@example.com",
        apiKey: "re_test_key",
        from: "amadeus@example.com",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.subject).toContain("ONA-123");
      expect(body.subject).toContain("Feedback");
      expect(body.text).toContain("Fix the bug");
    });
  });

  describe("notifyReviewReady", () => {
    it("sends notification with correct format", async () => {
      await notifyReviewReady({
        issueIdentifier: "ONA-456",
        issueTitle: "Add feature",
        to: "user@example.com",
        apiKey: "re_test_key",
        from: "amadeus@example.com",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.subject).toContain("ONA-456");
      expect(body.subject).toContain("Review");
      expect(body.text).toContain("Add feature");
    });
  });

  describe("shouldNotify", () => {
    it("returns true when transitioning to Feedback Needed", () => {
      expect(shouldNotify("Building", "Feedback Needed")).toBe(true);
      expect(shouldNotify("Planning", "Feedback Needed")).toBe(true);
      expect(shouldNotify(undefined, "Feedback Needed")).toBe(true);
    });

    it("returns true when transitioning to Review", () => {
      expect(shouldNotify("Building", "Review")).toBe(true);
      expect(shouldNotify("Feedback Needed", "Review")).toBe(true);
    });

    it("returns false when staying in same state", () => {
      expect(shouldNotify("Feedback Needed", "Feedback Needed")).toBe(false);
      expect(shouldNotify("Review", "Review")).toBe(false);
    });

    it("returns false for other state transitions", () => {
      expect(shouldNotify("Feedback Needed", "Building")).toBe(false);
      expect(shouldNotify("Review", "Done")).toBe(false);
      expect(shouldNotify("Planning", "Building")).toBe(false);
    });
  });
});

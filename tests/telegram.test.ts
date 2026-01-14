// ABOUTME: Tests for Telegram notification module.
// ABOUTME: Verifies notification sending via Telegram Bot API and message parsing.

import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import {
  sendTelegramNotification,
  notifyFeedbackNeededTelegram,
  notifyReviewReadyTelegram,
  parseIssueFromMessage,
} from "../src/telegram";

describe("telegram", () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
          status: 200,
        })
      )
    );
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("sendTelegramNotification", () => {
    it("calls Telegram API with correct payload", async () => {
      await sendTelegramNotification({
        chatId: "123456",
        message: "Test message",
        botToken: "bot_token_123",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.telegram.org/botbot_token_123/sendMessage");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.chat_id).toBe("123456");
      expect(body.text).toBe("Test message");
      expect(body.parse_mode).toBe("HTML");
    });

    it("returns success result on 200 response", async () => {
      const result = await sendTelegramNotification({
        chatId: "123456",
        message: "Test",
        botToken: "bot_token_123",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(123);
    });

    it("returns failure result on API error", async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, description: "Bad Request: chat not found" }),
            { status: 400 }
          )
        )
      );

      const result = await sendTelegramNotification({
        chatId: "invalid",
        message: "Test",
        botToken: "bot_token_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("chat not found");
    });

    it("returns failure result on network error", async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

      const result = await sendTelegramNotification({
        chatId: "123456",
        message: "Test",
        botToken: "bot_token_123",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("skips sending when bot token is missing", async () => {
      const result = await sendTelegramNotification({
        chatId: "123456",
        message: "Test",
        botToken: "",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Bot token");
    });

    it("skips sending when chat ID is missing", async () => {
      const result = await sendTelegramNotification({
        chatId: "",
        message: "Test",
        botToken: "bot_token_123",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Chat ID");
    });
  });

  describe("notifyFeedbackNeededTelegram", () => {
    it("sends notification with correct format", async () => {
      await notifyFeedbackNeededTelegram({
        issueIdentifier: "ONA-123",
        issueTitle: "Fix the bug",
        issueUrl: "https://linear.app/ona/issue/ONA-123",
        chatId: "123456",
        botToken: "bot_token_123",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.text).toContain("ONA-123");
      expect(body.text).toContain("Feedback Needed");
      expect(body.text).toContain("Fix the bug");
      expect(body.text).toContain("https://linear.app/ona/issue/ONA-123");
    });
  });

  describe("notifyReviewReadyTelegram", () => {
    it("sends notification with correct format", async () => {
      await notifyReviewReadyTelegram({
        issueIdentifier: "ONA-456",
        issueTitle: "Add feature",
        issueUrl: "https://linear.app/ona/issue/ONA-456",
        chatId: "123456",
        botToken: "bot_token_123",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.text).toContain("ONA-456");
      expect(body.text).toContain("Review");
      expect(body.text).toContain("Add feature");
      expect(body.text).toContain("https://linear.app/ona/issue/ONA-456");
    });
  });

  describe("parseIssueFromMessage", () => {
    it("parses issue identifier and message from standard format", () => {
      const result = parseIssueFromMessage("ONA-123: approve the plan");
      expect(result).toEqual({
        issueIdentifier: "ONA-123",
        message: "approve the plan",
      });
    });

    it("handles lowercase issue identifiers", () => {
      const result = parseIssueFromMessage("ona-123: looks good");
      expect(result).toEqual({
        issueIdentifier: "ONA-123",
        message: "looks good",
      });
    });

    it("handles multiple colons in message", () => {
      const result = parseIssueFromMessage("ONA-123: the fix is: use a different approach");
      expect(result).toEqual({
        issueIdentifier: "ONA-123",
        message: "the fix is: use a different approach",
      });
    });

    it("trims whitespace from message", () => {
      const result = parseIssueFromMessage("ONA-123:   lots of spaces   ");
      expect(result).toEqual({
        issueIdentifier: "ONA-123",
        message: "lots of spaces",
      });
    });

    it("returns null for invalid format", () => {
      expect(parseIssueFromMessage("hello world")).toBeNull();
      expect(parseIssueFromMessage("ONA-123")).toBeNull();
      expect(parseIssueFromMessage("123: no prefix")).toBeNull();
      expect(parseIssueFromMessage("")).toBeNull();
    });

    it("handles various team prefixes", () => {
      expect(parseIssueFromMessage("ABC-1: msg")).toEqual({
        issueIdentifier: "ABC-1",
        message: "msg",
      });
      expect(parseIssueFromMessage("TEAM-9999: msg")).toEqual({
        issueIdentifier: "TEAM-9999",
        message: "msg",
      });
    });
  });
});

// ABOUTME: Telegram notification module using Telegram Bot API.
// ABOUTME: Sends notifications when agents need feedback or are ready for review.

export interface TelegramNotificationOptions {
  chatId: string;
  message: string;
  botToken: string;
}

export interface TelegramNotificationResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

export interface TelegramIssueNotificationOptions {
  issueIdentifier: string;
  issueTitle: string;
  issueUrl: string;
  chatId: string;
  botToken: string;
}

export interface ParsedIssueMessage {
  issueIdentifier: string;
  message: string;
}

export async function sendTelegramNotification(
  options: TelegramNotificationOptions
): Promise<TelegramNotificationResult> {
  const { chatId, message, botToken } = options;

  if (!botToken) {
    return { success: false, error: "Bot token not configured" };
  }

  if (!chatId) {
    return { success: false, error: "Chat ID not configured" };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      }
    );

    const data = await response.json();

    if (!data.ok) {
      return {
        success: false,
        error: data.description ?? `API error: ${response.status}`,
      };
    }

    return { success: true, messageId: data.result?.message_id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function notifyFeedbackNeededTelegram(
  options: TelegramIssueNotificationOptions
): Promise<TelegramNotificationResult> {
  const { issueIdentifier, issueTitle, issueUrl, chatId, botToken } = options;

  const message = `🔔 <b>[${issueIdentifier}] Feedback Needed</b>

${issueTitle}

<a href="${issueUrl}">View in Linear</a>

Reply with "<code>${issueIdentifier}: your feedback</code>" to respond.`;

  return sendTelegramNotification({ chatId, message, botToken });
}

export async function notifyReviewReadyTelegram(
  options: TelegramIssueNotificationOptions
): Promise<TelegramNotificationResult> {
  const { issueIdentifier, issueTitle, issueUrl, chatId, botToken } = options;

  const message = `✅ <b>[${issueIdentifier}] Ready for Review</b>

${issueTitle}

PR is ready for review.

<a href="${issueUrl}">View in Linear</a>`;

  return sendTelegramNotification({ chatId, message, botToken });
}

/**
 * Parse an issue identifier and message from a Telegram reply.
 * Expected format: "ONA-123: your message here"
 */
export function parseIssueFromMessage(text: string): ParsedIssueMessage | null {
  if (!text) return null;

  // Match pattern: TEAM-123: message
  const match = text.match(/^([A-Za-z]+-\d+):\s*(.+)$/s);
  if (!match) return null;

  const [, issueIdentifier, message] = match;

  return {
    issueIdentifier: issueIdentifier.toUpperCase(),
    message: message.trim(),
  };
}

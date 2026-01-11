// ABOUTME: Email notification module using Resend API.
// ABOUTME: Sends notifications when agents need feedback or are ready for review.

export interface NotificationOptions {
  to: string;
  subject: string;
  body: string;
  apiKey: string;
  from: string;
}

export interface NotificationResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface IssueNotificationOptions {
  issueIdentifier: string;
  issueTitle: string;
  to: string;
  apiKey: string;
  from: string;
}

const NOTIFY_STATES = ["Feedback Needed", "Review"];

export function shouldNotify(
  previousState: string | undefined,
  newState: string
): boolean {
  if (previousState === newState) {
    return false;
  }
  return NOTIFY_STATES.includes(newState);
}

export async function sendNotification(
  options: NotificationOptions
): Promise<NotificationResult> {
  const { to, subject, body, apiKey, from } = options;

  if (!apiKey) {
    return { success: false, error: "API key not configured" };
  }

  if (!to) {
    return { success: false, error: "No recipient configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: body,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? `API error: ${response.status}`,
      };
    }

    return { success: true, id: data.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function notifyFeedbackNeeded(
  options: IssueNotificationOptions
): Promise<NotificationResult> {
  const { issueIdentifier, issueTitle, to, apiKey, from } = options;

  return sendNotification({
    to,
    apiKey,
    from,
    subject: `[${issueIdentifier}] Feedback Needed`,
    body: `Agent needs feedback on: ${issueTitle}\n\nPlease check Linear for details.`,
  });
}

export async function notifyReviewReady(
  options: IssueNotificationOptions
): Promise<NotificationResult> {
  const { issueIdentifier, issueTitle, to, apiKey, from } = options;

  return sendNotification({
    to,
    apiKey,
    from,
    subject: `[${issueIdentifier}] Ready for Review`,
    body: `Agent completed work on: ${issueTitle}\n\nPR is ready for review.`,
  });
}

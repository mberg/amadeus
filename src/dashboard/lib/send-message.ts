// ABOUTME: Utility function for sending messages to agents.
// ABOUTME: Posts to /trigger endpoint with agent key and message.

export interface SendMessageResult {
  success: boolean;
  error?: string;
}

export async function sendMessage(
  agentKey: string,
  message: string
): Promise<SendMessageResult> {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return { success: false, error: "Message cannot be empty" };
  }

  try {
    const response = await fetch("/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentKey,
        message: trimmedMessage,
      }),
    });

    if (!response.ok) {
      return { success: false, error: "Failed to send message" };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

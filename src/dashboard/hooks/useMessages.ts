// ABOUTME: React hook for fetching messages for a specific task.
// ABOUTME: Polls messages when a task is selected and provides loading states.

import { useState, useEffect, useCallback } from "react";
import type { Message, MessagesResponse } from "../types";

const POLL_INTERVAL = 1500; // 1.5 seconds

interface UseMessagesReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export function useMessages(taskKey: string | null, machineUrl?: string): UseMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!taskKey) return;

    try {
      let response: Response;

      if (machineUrl) {
        // Remote task - use hub proxy
        response = await fetch("/hub/proxy/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineUrl, taskKey }),
        });
      } else {
        // Local task
        response = await fetch(`/agents/${encodeURIComponent(taskKey)}/messages`);
      }

      if (!response.ok) {
        if (response.status === 404) {
          setError("Task not found");
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const data: MessagesResponse = await response.json();
      setMessages(data.messages || []);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch messages:", err);
      setError("Failed to load messages");
    } finally {
      setIsLoading(false);
    }
  }, [taskKey, machineUrl]);

  // Reset when taskKey changes
  useEffect(() => {
    if (taskKey) {
      setIsLoading(true);
      setMessages([]);
      setError(null);
      fetchMessages();
    } else {
      setMessages([]);
      setError(null);
    }
  }, [taskKey, fetchMessages]);

  // Polling interval
  useEffect(() => {
    if (!taskKey) return;

    const interval = setInterval(fetchMessages, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [taskKey, fetchMessages]);

  return {
    messages,
    isLoading,
    error,
  };
}

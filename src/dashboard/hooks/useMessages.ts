// ABOUTME: React hook for fetching messages for a specific task.
// ABOUTME: Uses a WebSocket subscription to receive real-time message updates.

import { useState, useEffect } from "react";
import type { Message } from "../types";

interface UseMessagesReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export function useMessages(taskKey: string | null, machineName?: string | null): UseMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskKey) {
      setMessages([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setMessages([]);
    setError(null);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/dashboard`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "subscribe-messages",
        machineName: machineName ?? null,
        agentKey: taskKey,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "messages-update" && msg.agentKey === taskKey) {
          setMessages(msg.messages || []);
          setIsLoading(false);
          setError(null);
        } else if (msg.type === "messages-error" && msg.agentKey === taskKey) {
          setError(msg.error);
          setIsLoading(false);
        }
      } catch {}
    };

    ws.onerror = () => {
      setError("Failed to load messages");
      setIsLoading(false);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "unsubscribe-messages", agentKey: taskKey }));
      }
      ws.close();
    };
  }, [taskKey, machineName]);

  return { messages, isLoading, error };
}

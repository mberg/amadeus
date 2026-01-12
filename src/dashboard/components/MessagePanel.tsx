// ABOUTME: Message panel sidebar for viewing task conversation history.
// ABOUTME: Displays messages between user and assistant with real-time updates.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { useMessages } from "../hooks/useMessages";
import type { Task, Message } from "../types";
import { cn, stripTerminalSequences } from "../lib/utils";

interface MessagePanelProps {
  task: Task | null;
  onClose: () => void;
}

function MessageBubble({ message }: { message: Message }) {
  const content = stripTerminalSequences(message.content);
  if (!content) return null;

  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "rounded-lg p-3 text-sm",
        isUser
          ? "border-l-2 border-status-working bg-status-working/10"
          : "border-l-2 border-status-idle bg-status-idle/5"
      )}
    >
      <div
        className={cn(
          "mb-1 text-xs font-medium uppercase tracking-wide",
          isUser ? "text-status-working" : "text-muted-foreground"
        )}
      >
        {message.role}
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground/90">
        {content}
      </div>
    </div>
  );
}

export function MessagePanel({ task, onClose }: MessagePanelProps) {
  const { messages, isLoading, error } = useMessages(task?.key ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!task) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/80 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-background shadow-xl md:w-1/2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">Messages</span>
            <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">
              {task.issueIdentifier}
            </span>
            <span className="max-w-[200px] truncate text-sm text-muted-foreground">
              {task.issueTitle}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading messages...
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center py-8 text-destructive">
              {error}
            </div>
          )}

          {!isLoading && !error && messages.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              No messages yet
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}
        </div>
      </div>
    </>
  );
}

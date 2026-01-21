// ABOUTME: Message panel sidebar for viewing task conversation history.
// ABOUTME: Displays messages between user and assistant with real-time updates.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  Copy,
  ChevronDown,
  User,
  Sparkles,
  Check,
  Send,
  Loader2,
} from "lucide-react";
import { Button } from "./ui/button";
import { useMessages } from "../hooks/useMessages";
import type { Task, Message } from "../types";
import { cn, stripTerminalSequences } from "../lib/utils";
import { sendMessage } from "../lib/send-message";

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
        "rounded px-3 py-2 text-[13px]",
        isUser
          ? "bg-foreground text-background"
          : "border border-border bg-muted/30"
      )}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider",
          isUser ? "text-background/70" : "text-muted-foreground"
        )}
      >
        {isUser ? (
          <User className="h-3 w-3" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {message.role}
      </div>
      <div
        className={cn(
          "whitespace-pre-wrap break-words font-mono leading-relaxed",
          isUser ? "text-background/90" : "text-foreground/90"
        )}
      >
        {content}
      </div>
    </div>
  );
}

export function MessagePanel({ task, onClose }: MessagePanelProps) {
  const { messages, isLoading, error } = useMessages(task?.key ?? null, task?.machineUrl);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [copied, setCopied] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const checkIfAtBottom = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const threshold = 50;
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < threshold);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  }, []);

  // Only auto-scroll if user is at bottom
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isAtBottom, scrollToBottom]);

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

  const handleCopy = useCallback(async () => {
    const text = messages
      .map((m) => {
        const content = stripTerminalSequences(m.content);
        return `${m.role.toUpperCase()}:\n${content}`;
      })
      .filter((t) => t.includes("\n") && t.split("\n")[1])
      .join("\n\n---\n\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!task || !inputText.trim() || isSending) return;

    setIsSending(true);
    const result = await sendMessage(task.key, inputText, task.machineUrl);
    setIsSending(false);

    if (result.success) {
      setInputText("");
      // Focus back on textarea after sending
      textareaRef.current?.focus();
    } else {
      console.error("Failed to send message:", result.error);
    }
  }, [task, inputText, isSending]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Agent is not running if we have an error (typically 404)
  const isAgentRunning = !error;

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
        <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="font-medium text-foreground">Messages</span>
            <span className="rounded bg-primary/20 px-1.5 py-0.5 font-mono text-[11px] text-primary">
              {task.issueIdentifier}
            </span>
            <span className="max-w-[180px] truncate text-xs text-muted-foreground">
              {task.issueTitle}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              disabled={messages.length === 0}
              className="h-8 w-8"
              title="Copy all messages"
            >
              {copied ? (
                <Check className="h-4 w-4 text-chart-1" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={checkIfAtBottom}
          className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-3"
        >
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading messages...
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center py-8 text-sm text-destructive">
              {error}
            </div>
          )}

          {!isLoading && !error && messages.length === 0 && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No messages yet
            </div>
          )}

          {messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-card p-3">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                isAgentRunning
                  ? "Type a message... (Enter to send, Shift+Enter for newline)"
                  : "Agent not running"
              }
              disabled={!isAgentRunning || isSending}
              className={cn(
                "flex-1 resize-none rounded border border-border bg-background px-3 py-2 font-mono text-sm",
                "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "min-h-[40px] max-h-[120px]"
              )}
              rows={1}
              style={{
                height: "auto",
                minHeight: "40px",
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!isAgentRunning || isSending || !inputText.trim()}
              size="icon"
              className="h-10 w-10 shrink-0"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Scroll to bottom button */}
        {!isAtBottom && messages.length > 0 && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
            <Button
              variant="secondary"
              size="sm"
              onClick={scrollToBottom}
              className="gap-1 rounded-full shadow-lg"
            >
              <ChevronDown className="h-4 w-4" />
              Jump to bottom
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

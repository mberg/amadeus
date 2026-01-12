// ABOUTME: Utility functions for the dashboard components.
// ABOUTME: Provides the cn() function for merging Tailwind classes.

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function stripTerminalSequences(text: string): string {
  // ANSI escape sequences (colors, cursor movement, etc.)
  const ansiPattern = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
  // Spinner characters and cursor control sequences
  const spinnerPattern = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+/g;
  // Carriage return and other control characters
  const controlPattern = /[\x00-\x09\x0b\x0c\x0e-\x1f]/g;

  return text
    .replace(ansiPattern, "")
    .replace(spinnerPattern, "")
    .replace(controlPattern, "")
    .trim();
}

export type StateVariant =
  | "planning"
  | "building"
  | "feedback"
  | "review"
  | "done"
  | "default";

export function getStateVariant(state: string | undefined): StateVariant {
  if (!state) return "default";
  const lower = state.toLowerCase();
  if (lower.includes("planning") || lower.includes("scoping")) return "planning";
  if (lower.includes("build")) return "building";
  if (lower.includes("feedback")) return "feedback";
  if (lower.includes("review")) return "review";
  if (lower.includes("done")) return "done";
  return "default";
}

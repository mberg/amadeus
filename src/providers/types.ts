// ABOUTME: Provider interface for issue tracking systems (Linear, GitHub).
// ABOUTME: Abstracts webhook handling, issue operations, and prompt building.

import type { AgentProfile } from "../types";
import type { PersistedAgentState } from "../persistence";

/**
 * Normalized issue representation used across providers.
 */
export interface ParsedIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  state?: {
    id: string;
    name: string;
    type?: string;
  };
  assignee?: { id: string };
  labels?: { name: string }[];
  teamKey?: string;
  projectName?: string;
  // Provider-specific data for operations that need it
  raw: unknown;
}

/**
 * Normalized comment representation used across providers.
 */
export interface ParsedComment {
  id: string;
  body: string;
  issueId: string;
  issue: ParsedIssue;
  author?: {
    id: string;
    name: string;
  };
  createdAt: string;
  raw: unknown;
}

/**
 * Fetched comment for history display.
 */
export interface FetchedComment {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

/**
 * Result of parsing a webhook payload.
 */
export type ParsedWebhook =
  | { type: "issue"; action: "create" | "update" | "remove"; issue: ParsedIssue }
  | { type: "comment"; action: "create" | "update" | "remove"; comment: ParsedComment }
  | { type: "unknown"; action: string };

/**
 * Workflow state identifiers for a provider.
 */
export interface WorkflowStates {
  planning: string;
  feedbackNeeded: string;
  building: string;
  review: string;
  done: string;
}

/**
 * Provider configuration passed to factory.
 */
export interface ProviderConfig {
  type: "linear" | "github";
  realmName: string;
  agentName?: string;
  triggerStates?: string[];
  botUserId?: string;
  // Linear-specific
  linearWorkspace?: string;
  linearApiKey?: string;
  linearWebhookSecret?: string;
  // GitHub-specific
  githubOwner?: string;
  githubRepo?: string;
  githubProjectNumber?: number;
  githubToken?: string;
  githubWebhookSecret?: string;
}

/**
 * Interface for issue tracking providers (Linear, GitHub, etc.).
 * Abstracts all provider-specific logic for webhook handling, issue operations, and prompts.
 */
export interface IssueTrackingProvider {
  /** Provider type identifier */
  readonly type: "linear" | "github";

  /** Realm name for this provider instance */
  readonly realmName: string;

  /** Agent name used in comments */
  readonly agentName: string;

  // ─────────────────────────────────────────────────────────────────
  // Webhook handling
  // ─────────────────────────────────────────────────────────────────

  /**
   * Verify webhook signature matches expected secret.
   */
  verifyWebhook(payload: string, signature: string | null): Promise<boolean>;

  /**
   * Parse webhook payload into normalized format.
   */
  parseWebhook(payload: string): ParsedWebhook;

  /**
   * Validate webhook timestamp to prevent replay attacks.
   * Returns true if timestamp is valid.
   */
  validateTimestamp(payload: string): boolean;

  // ─────────────────────────────────────────────────────────────────
  // Issue operations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Generate unique agent key for an issue.
   */
  getAgentKey(issue: ParsedIssue): string;

  /**
   * Check if agent should be started for this issue.
   */
  shouldStartAgent(issue: ParsedIssue): boolean;

  /**
   * Check if agent should be terminated for this issue.
   */
  shouldTerminateAgent(issue: ParsedIssue): boolean;

  /**
   * Check if issue is awaiting user feedback.
   */
  isAwaitingFeedback(issue: ParsedIssue): boolean;

  /**
   * Check if issue is in a draft/triage state.
   */
  isDraft(issue: ParsedIssue): boolean;

  /**
   * Check if a comment was posted by the bot.
   */
  isBotComment(comment: ParsedComment): boolean;

  /**
   * Determine completion reason from issue state.
   */
  getCompletionReason(issue: ParsedIssue): "done" | "stopped" | "canceled" | "backlog";

  // ─────────────────────────────────────────────────────────────────
  // State management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get workflow state identifiers.
   */
  getWorkflowStates(): WorkflowStates;

  /**
   * Update issue to a new state.
   */
  updateIssueState(issueIdentifier: string, stateId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Comments
  // ─────────────────────────────────────────────────────────────────

  /**
   * Fetch all comments for an issue.
   */
  fetchComments(issueId: string): Promise<FetchedComment[]>;

  /**
   * Post a comment to an issue.
   */
  postComment(issueIdentifier: string, body: string): Promise<void>;

  /**
   * Post acknowledgment comment when starting work.
   */
  acknowledgeIssue(issueIdentifier: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────
  // Prompt building
  // ─────────────────────────────────────────────────────────────────

  /**
   * Build the initial prompt for an issue.
   */
  buildPrompt(
    issue: ParsedIssue,
    profile?: AgentProfile,
    githubRepoUrl?: string,
    existingComments?: FetchedComment[]
  ): string;

  /**
   * Build prompt for a new comment.
   */
  buildCommentPrompt(comment: ParsedComment): string;

  /**
   * Build recovery prompt after agent crash.
   */
  buildRecoveryPrompt(issue: ParsedIssue, savedState: PersistedAgentState, profile?: AgentProfile): string;

  // ─────────────────────────────────────────────────────────────────
  // Environment
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get environment variables to pass to agent process.
   */
  getAgentEnv(): Record<string, string>;
}

/**
 * Factory function type for creating providers.
 */
export type ProviderFactory = (config: ProviderConfig) => IssueTrackingProvider;

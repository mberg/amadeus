// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt, buildCommentPrompt, buildPromptWithCommentHistory } from "../src/prompt";
import type { LinearIssue, AgentProfile, LinearComment } from "../src/types";
import type { CommentData } from "../src/linear-api";

describe("buildPrompt", () => {
  it("includes issue identifier and title", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Add user authentication",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("ENG-42");
    expect(prompt).toContain("Add user authentication");
  });

  it("includes description when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Implement OAuth2 flow",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("Implement OAuth2 flow");
  });

  it("handles missing description", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("No description provided");
  });

  it("includes labels when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      labels: [{ name: "bug" }, { name: "urgent" }],
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("bug");
    expect(prompt).toContain("urgent");
  });

  it("includes priority when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      priority: 1,
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("**Priority**: 1");
  });

  it("includes profile prompt additions when provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };
    const profile: AgentProfile = {
      promptAdditions: [
        "You have access to Playwright for browser automation.",
        "Use the frontend-design skill for UI work.",
      ],
    };

    const prompt = buildPrompt(issue, profile);

    expect(prompt).toContain("Profile Capabilities");
    expect(prompt).toContain("You have access to Playwright");
    expect(prompt).toContain("frontend-design skill");
  });

  it("excludes profile section when no prompt additions", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };
    const profile: AgentProfile = {
      mcpServers: { linear: { command: "npx", args: [] } },
    };

    const prompt = buildPrompt(issue, profile);

    expect(prompt).not.toContain("Profile Capabilities");
  });

  it("excludes profile section when profile is undefined", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).not.toContain("Profile Capabilities");
  });

  it("includes star command when setting Feedback Needed status", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toContain("star");
    expect(prompt).toContain("favoriteCreate");
    expect(prompt).toContain("ENG-42");
  });
});

describe("buildCommentPrompt", () => {
  it("includes star command when setting Feedback Needed status", () => {
    const comment: LinearComment = {
      id: "comment-123",
      body: "Can you clarify this?",
      issue: {
        id: "issue-123",
        identifier: "ENG-42",
        title: "Test issue",
      },
      user: {
        name: "Matt",
      },
    };

    const prompt = buildCommentPrompt(comment);

    expect(prompt).toContain("star");
    expect(prompt).toContain("favoriteCreate");
    expect(prompt).toContain("ENG-42");
  });
});

describe("buildPromptWithCommentHistory", () => {
  const baseIssue: LinearIssue = {
    id: "issue-123",
    identifier: "ENG-42",
    title: "Test issue",
    description: "Test description",
  };

  it("includes issue details", () => {
    const prompt = buildPromptWithCommentHistory(baseIssue, []);

    expect(prompt).toContain("ENG-42");
    expect(prompt).toContain("Test issue");
    expect(prompt).toContain("Test description");
  });

  it("includes all comments in chronological order", () => {
    const comments: CommentData[] = [
      {
        id: "c1",
        body: "First comment",
        createdAt: "2024-01-10T10:00:00Z",
        user: { id: "u1", name: "Alice" },
      },
      {
        id: "c2",
        body: "Second comment",
        createdAt: "2024-01-10T11:00:00Z",
        user: { id: "u2", name: "Bob" },
      },
    ];

    const prompt = buildPromptWithCommentHistory(baseIssue, comments);

    expect(prompt).toContain("Comment History");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("First comment");
    expect(prompt).toContain("Bob");
    expect(prompt).toContain("Second comment");
    // Verify order: First should appear before Second
    const firstIndex = prompt.indexOf("First comment");
    const secondIndex = prompt.indexOf("Second comment");
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  it("handles comments without user", () => {
    const comments: CommentData[] = [
      {
        id: "c1",
        body: "Anonymous comment",
        createdAt: "2024-01-10T10:00:00Z",
        user: null,
      },
    ];

    const prompt = buildPromptWithCommentHistory(baseIssue, comments);

    expect(prompt).toContain("Anonymous comment");
    expect(prompt).toContain("Unknown");
  });

  it("omits comment history section when no comments", () => {
    const prompt = buildPromptWithCommentHistory(baseIssue, []);

    expect(prompt).not.toContain("Comment History");
  });

  it("includes profile prompt additions", () => {
    const profile: AgentProfile = {
      promptAdditions: ["You have access to Playwright."],
    };

    const prompt = buildPromptWithCommentHistory(baseIssue, [], profile);

    expect(prompt).toContain("Profile Capabilities");
    expect(prompt).toContain("Playwright");
  });

  it("includes instructions for continuing work", () => {
    const comments: CommentData[] = [
      {
        id: "c1",
        body: "Please fix the bug",
        createdAt: "2024-01-10T10:00:00Z",
        user: { id: "u1", name: "Matt" },
      },
    ];

    const prompt = buildPromptWithCommentHistory(baseIssue, comments);

    // Should include context about resuming work
    expect(prompt).toContain("Building");
    expect(prompt).toContain("linear-cli");
  });
});

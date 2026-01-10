// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt, buildCommentPrompt } from "../src/prompt";
import type { LinearIssue, LinearComment, AgentProfile } from "../src/types";

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

  it("pairs initial Building state change with a comment", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    // The first state change to Building should be followed by a comment
    // Check that after the Building state command, there's a comment command
    const buildingStateRegex =
      /linear-cli issues update.*--state "0aab3254.*"[\s\S]*?linear-cli comments create.*Starting work/;
    expect(prompt).toMatch(buildingStateRegex);
  });

  it("pairs Feedback Needed state change with a comment instruction", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    // Instructions for Feedback Needed should mention posting a comment with the question
    expect(prompt).toContain("Feedback Needed");
    // The prompt should explicitly say to post a comment when setting Feedback Needed
    expect(prompt).toMatch(
      /post.*comment.*question.*Feedback Needed|Feedback Needed.*post.*comment/i
    );
  });
});

describe("buildCommentPrompt", () => {
  it("pairs Building state change with a comment about resuming work", () => {
    const comment: LinearComment = {
      id: "comment-123",
      body: "Please also add tests",
      issueId: "issue-123",
      issue: {
        id: "issue-123",
        identifier: "ENG-42",
        title: "Test issue",
      },
      user: { name: "Matt" },
    };

    const prompt = buildCommentPrompt(comment);

    // The Building state command should be followed by a comment about resuming
    const buildingStateRegex =
      /linear-cli issues update.*--state "0aab3254.*"[\s\S]*?linear-cli comments create.*Resuming work/i;
    expect(prompt).toMatch(buildingStateRegex);
  });

  it("pairs Review state change with a comment", () => {
    const comment: LinearComment = {
      id: "comment-123",
      body: "Please also add tests",
      issueId: "issue-123",
      issue: {
        id: "issue-123",
        identifier: "ENG-42",
        title: "Test issue",
      },
      user: { name: "Matt" },
    };

    const prompt = buildCommentPrompt(comment);

    // Review state change should be paired with a comment
    const reviewStateRegex =
      /linear-cli issues update.*--state "e5708707.*"[\s\S]*?linear-cli comments create/;
    expect(prompt).toMatch(reviewStateRegex);
  });

  it("pairs Feedback Needed state change with a comment instruction", () => {
    const comment: LinearComment = {
      id: "comment-123",
      body: "Please also add tests",
      issueId: "issue-123",
      issue: {
        id: "issue-123",
        identifier: "ENG-42",
        title: "Test issue",
      },
      user: { name: "Matt" },
    };

    const prompt = buildCommentPrompt(comment);

    // Feedback Needed instruction should mention posting a comment
    expect(prompt).toMatch(
      /Feedback Needed[\s\S]*?linear-cli comments create|post.*comment.*Feedback Needed/i
    );
  });
});

// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt } from "../src/prompt";
import type { LinearIssue, AgentProfile } from "../src/types";

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
});

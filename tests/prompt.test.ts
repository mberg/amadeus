// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt, buildCommentPrompt, isYoloMode } from "../src/prompt";
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

  it("pairs plan comment with Feedback Needed state change", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    // In Planning workflow, posting the plan comment should precede the Feedback Needed state change
    const planThenFeedbackRegex =
      /linear-cli comments create.*plan[\s\S]*?linear-cli issues update.*--state "38ab3462/;
    expect(prompt).toMatch(planThenFeedbackRegex);
  });

  it("instructs agent to stop after setting Feedback Needed", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    // Agent should be told to STOP after setting Feedback Needed
    expect(prompt).toContain("Feedback Needed");
    expect(prompt).toMatch(/Feedback Needed.*STOP|STOP.*Feedback Needed/i);
  });
});

describe("isYoloMode", () => {
  it("returns true when description contains 'yolo' lowercase", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Please implement this feature yolo",
    };

    expect(isYoloMode(issue)).toBe(true);
  });

  it("returns true when description contains 'YOLO' uppercase", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Do this YOLO style",
    };

    expect(isYoloMode(issue)).toBe(true);
  });

  it("returns true when description contains 'Yolo' mixed case", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Yolo - just do it",
    };

    expect(isYoloMode(issue)).toBe(true);
  });

  it("returns false when description does not contain yolo", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Normal description without the keyword",
    };

    expect(isYoloMode(issue)).toBe(false);
  });

  it("returns false when description is undefined", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    expect(isYoloMode(issue)).toBe(false);
  });
});

describe("buildPrompt YOLO mode", () => {
  it("skips Feedback Needed state when YOLO mode is active", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Implement this feature yolo",
    };

    const prompt = buildPrompt(issue);

    // Should NOT contain the Feedback Needed state ID in the workflow section
    expect(prompt).not.toMatch(/Step 4.*Feedback Needed/i);
    expect(prompt).not.toMatch(/STOP and wait for the user/i);
  });

  it("goes directly to Building state in YOLO mode", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "yolo mode please",
    };

    const prompt = buildPrompt(issue);

    // Should contain Building state in the workflow
    expect(prompt).toContain("0aab3254-cc63-4979-84ab-eda800979c94");
    expect(prompt).toMatch(/proceed.*implement|implement.*immediately/i);
  });

  it("mentions YOLO mode is active in the prompt", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
      description: "Do this yolo",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).toMatch(/yolo.*mode|YOLO.*mode/i);
  });
});

describe("buildCommentPrompt", () => {
  it("pairs Building state change with a comment about starting implementation", () => {
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

    // The Building state command should be followed by a comment about starting implementation
    const buildingStateRegex =
      /linear-cli issues update.*--state "0aab3254.*"[\s\S]*?linear-cli comments create.*Starting implementation/i;
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

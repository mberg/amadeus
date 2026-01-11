// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt, buildCommentPrompt, buildRecoveryPrompt } from "../src/prompt";
import type { LinearIssue, LinearComment, AgentProfile } from "../src/types";
import type { PersistedAgentState } from "../src/persistence";

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

describe("buildRecoveryPrompt", () => {
  const makeIssue = (overrides?: Partial<LinearIssue>): LinearIssue => ({
    id: "issue-123",
    identifier: "ENG-42",
    title: "Add user authentication",
    description: "Implement OAuth2 flow for user login",
    ...overrides,
  });

  const makeSavedState = (
    overrides?: Partial<PersistedAgentState>
  ): PersistedAgentState => ({
    key: "ENG-issue-123",
    issueId: "issue-123",
    issueIdentifier: "ENG-42",
    issueTitle: "Add user authentication",
    projectPath: "/tmp/test-project",
    port: 8001,
    status: "dead",
    linearState: "Building",
    conversationSnapshot: [],
    lastHeartbeat: new Date(),
    ...overrides,
  });

  it("indicates agent is recovering from a crash", () => {
    const issue = makeIssue();
    const savedState = makeSavedState();

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toContain("recovering");
    expect(prompt).toMatch(/crash|restart|resume/i);
  });

  it("includes the issue details", () => {
    const issue = makeIssue();
    const savedState = makeSavedState();

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toContain("ENG-42");
    expect(prompt).toContain("Add user authentication");
  });

  it("includes the last known Linear state", () => {
    const issue = makeIssue();
    const savedState = makeSavedState({ linearState: "Feedback Needed" });

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toContain("Feedback Needed");
  });

  it("includes conversation summary when messages exist", () => {
    const issue = makeIssue();
    const savedState = makeSavedState({
      conversationSnapshot: [
        { role: "user", content: "Initial task prompt" },
        { role: "assistant", content: "I will implement the OAuth2 flow" },
        { role: "user", content: "Please proceed" },
      ],
    });

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toContain("Previous Conversation");
    expect(prompt).toContain("OAuth2");
  });

  it("handles empty conversation snapshot", () => {
    const issue = makeIssue();
    const savedState = makeSavedState({ conversationSnapshot: [] });

    const prompt = buildRecoveryPrompt(issue, savedState);

    // Should still be valid prompt
    expect(prompt).toContain("ENG-42");
    expect(prompt).not.toContain("Previous Conversation");
  });

  it("instructs agent to check git status first", () => {
    const issue = makeIssue();
    const savedState = makeSavedState();

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toMatch(/git status|check.*changes/i);
  });

  it("instructs agent to post a recovery comment to Linear", () => {
    const issue = makeIssue();
    const savedState = makeSavedState();

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toContain("linear-cli comments create");
    expect(prompt).toMatch(/recover|restart|resume/i);
  });
});

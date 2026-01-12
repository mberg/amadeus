// ABOUTME: Tests for building Claude prompts from Linear issues.
// ABOUTME: Ensures prompts include all relevant issue information.

import { describe, expect, it } from "bun:test";
import { buildPrompt, buildCommentPrompt, buildRecoveryPrompt, isYoloMode } from "../src/prompt";
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

  it("includes workspace name for constructing mention URLs", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue, undefined, "ona");

    expect(prompt).toContain("ona");
    expect(prompt).toContain("linear.app");
    expect(prompt).toContain("profiles");
  });

  it("includes instructions to mention issue creator when requesting feedback", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue, undefined, "ona");

    // Should instruct agent to @mention the creator/assignee
    expect(prompt).toMatch(/mention|@|notify/i);
    expect(prompt).toMatch(/linear-cli issues get/i);
  });

  it("includes file linking instructions when githubRepoUrl is provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue, undefined, "ona", "Amadeus", "https://github.com/mberg/amadeus");

    expect(prompt).toContain("https://github.com/mberg/amadeus");
    expect(prompt).toContain("blob");
    expect(prompt).toContain("issue/ENG-42");
    expect(prompt).toMatch(/\[.*\]\(https:\/\/github\.com/);
  });

  it("excludes file linking section when githubRepoUrl is not provided", () => {
    const issue: LinearIssue = {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    };

    const prompt = buildPrompt(issue);

    expect(prompt).not.toContain("File References");
    expect(prompt).not.toContain("blob/issue/");
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
  const makeComment = (body: string, userName: string = "Matt"): LinearComment => ({
    id: "comment-123",
    body,
    issueId: "issue-123",
    issue: {
      id: "issue-123",
      identifier: "ENG-42",
      title: "Test issue",
    },
    user: { name: userName },
  });

  it("includes the comment body", () => {
    const comment = makeComment("Please also add tests");
    const prompt = buildCommentPrompt(comment);
    expect(prompt).toContain("Please also add tests");
  });

  it("includes the author name", () => {
    const comment = makeComment("Looks good!", "Matt Berg");
    const prompt = buildCommentPrompt(comment);
    expect(prompt).toContain("Matt Berg");
  });

  it("references the three feedback types", () => {
    const comment = makeComment("Approved");
    const prompt = buildCommentPrompt(comment);
    expect(prompt).toContain("Approved");
    expect(prompt).toContain("Changes requested");
    expect(prompt).toContain("Question");
  });

  it("references initial instructions for commands", () => {
    const comment = makeComment("Go ahead");
    const prompt = buildCommentPrompt(comment);
    expect(prompt).toContain("initial instructions");
  });

  it("is concise (avoids redundant state IDs and commands)", () => {
    const comment = makeComment("Proceed with the plan");
    const prompt = buildCommentPrompt(comment);
    // Should NOT include the full state ID UUIDs (they're in initial prompt)
    expect(prompt).not.toContain("0aab3254-cc63-4979-84ab-eda800979c94");
    expect(prompt).not.toContain("e5708707-32a0-4ede-9f24-fb525d92b3d4");
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

  it("instructs agent to fetch issue history from Linear", () => {
    const issue = makeIssue();
    const savedState = makeSavedState();

    const prompt = buildRecoveryPrompt(issue, savedState);

    expect(prompt).toContain("linear-cli issues get");
    expect(prompt).toContain("source of truth");
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

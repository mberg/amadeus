// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue } from "./types";

export function buildPrompt(issue: LinearIssue): string {
  return `
## New Task from Linear

**Issue**: ${issue.identifier} - ${issue.title}
**Priority**: ${issue.priority ?? "None"}
**Labels**: ${issue.labels?.map((l) => l.name).join(", ") || "None"}

### Description
${issue.description || "No description provided."}

### Instructions
1. First, analyze the requirements and update the Linear issue status to "Scoping"
2. Create a brief implementation plan as a comment on the issue
3. When ready to code, update status to "Building"
4. Implement the feature with tests
5. When complete, update status to "Review"
6. If you need my input, set status to "Feedback Needed" and comment with your question
`.trim();
}

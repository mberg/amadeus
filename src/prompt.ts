// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue } from "./types";

export function buildPrompt(issue: LinearIssue): string {
  return `
## New Task from Linear

**Issue**: ${issue.identifier} - ${issue.title}
**Issue ID**: ${issue.id}
**Priority**: ${issue.priority ?? "None"}
**Labels**: ${issue.labels?.map((l) => l.name).join(", ") || "None"}

### Description
${issue.description || "No description provided."}

### How to Communicate with Linear

You have access to the Linear MCP server. Use it to:
- Update issue status: Use the Linear MCP tool to change the issue state
- Post comments: Add comments to ${issue.identifier} to share your progress, ask questions, or report blockers
- The issue ID is: ${issue.id}
- The issue identifier is: ${issue.identifier}

These are also available as environment variables: LINEAR_ISSUE_ID and LINEAR_ISSUE_IDENTIFIER.

### Workflow

1. **Analyze**: Read the requirements. Post a comment on ${issue.identifier} with your implementation plan.
2. **Update status to "Building"**: When you start coding.
3. **Implement**: Write the code with tests. Commit your changes.
4. **Update status to "Review"**: When implementation is complete.
5. **If blocked**: Update status to "Feedback Needed" and post a comment explaining what you need.

### Important

- Always communicate your progress via Linear comments
- If you can't access Linear MCP, focus on the implementation and document your work in commit messages
- Keep the human in the loop—post meaningful updates, not just status changes
`.trim();
}

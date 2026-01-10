// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue, LinearComment } from "./types";

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

### Status Workflow

Use these statuses to communicate your progress:

| Status | When to Use |
|--------|-------------|
| **Scoping** | Analyzing requirements, creating plan |
| **Building** | Actively writing code |
| **Feedback Needed** | You have a question or need input from the user |
| **Review** | Work is complete and ready for human review |

**Important status rules:**
- After posting a comment with a question → set status to "Feedback Needed"
- After receiving feedback and resuming work → set status to "Building"
- When implementation is complete → set status to "Review"
- The user will see status changes in Linear, so always update status when your state changes

### Workflow

1. **Analyze**: Read the requirements. Post a comment on ${issue.identifier} with your implementation plan.
2. **Update status to "Building"**: When you start coding.
3. **Implement**: Write the code with tests. Commit your changes.
4. **Update status to "Review"**: When implementation is complete.
5. **If you need input**: Post a comment with your question AND update status to "Feedback Needed".

### Important

- Always communicate your progress via Linear comments
- Always update the issue status to reflect your current state
- If you can't access Linear MCP, focus on the implementation and document your work in commit messages
- Keep the human in the loop—post meaningful updates, not just status changes
`.trim();
}

export function buildCommentPrompt(comment: LinearComment): string {
  const authorName = comment.user?.name ?? "The user";

  return `
## New Comment on ${comment.issue.identifier}

**From**: ${authorName}
**Issue**: ${comment.issue.identifier} - ${comment.issue.title}

### Comment
${comment.body}

### Instructions

${authorName} has replied to your previous comment or added new information. Please:

1. **Read and understand** the feedback or question
2. **Respond appropriately**:
   - If they answered your question → continue with the work, update status to "Building"
   - If they asked a follow-up question → answer it and update status to "Feedback Needed" if you need more info
   - If they approved your work → proceed with implementation or mark as "Review" if done
   - If they requested changes → implement the changes
3. **Post a comment** on ${comment.issue.identifier} acknowledging their input and explaining your next steps
4. **Update the issue status** to reflect your current state:
   - "Building" if you're continuing work
   - "Feedback Needed" if you have questions
   - "Review" if work is complete

Remember: The user is watching Linear for status updates. Always update the status so they know what's happening.
`.trim();
}

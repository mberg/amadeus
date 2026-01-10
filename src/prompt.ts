// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue, LinearComment, AgentProfile } from "./types";

export function buildPrompt(issue: LinearIssue, profile?: AgentProfile): string {
  const profileSection = buildProfileSection(profile);

  return `
## New Task from Linear

**Issue**: ${issue.identifier} - ${issue.title}
**Issue ID**: ${issue.id}
**Priority**: ${issue.priority ?? "None"}
**Labels**: ${issue.labels?.map((l) => l.name).join(", ") || "None"}

### Description
${issue.description || "No description provided."}

### How to Communicate with Linear

Use the \`linear-cli\` command line tool for all Linear interactions.

**Post a comment:**
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** Your message here" ${issue.identifier}
\`\`\`
**Important:** Always prefix your comments with \`**🤖 Claude:**\` so users know it's from the AI agent.

**Update status:**
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "<state-id>"
\`\`\`

**State IDs:**
| Status | State ID |
|--------|----------|
| Scoping | \`260a76bf-dc1f-46ee-9c59-518c9558e7bb\` |
| Building | \`0aab3254-cc63-4979-84ab-eda800979c94\` |
| Feedback Needed | \`38ab3462-5550-4dcf-a1dd-6845e3a1e963\` |
| Review | \`e5708707-32a0-4ede-9f24-fb525d92b3d4\` |
| Done | \`edbec4af-dc30-4d27-a122-84395ac3b885\` |

**Issue details:**
- Issue ID: ${issue.id}
- Issue identifier: ${issue.identifier}

These are also available as environment variables: LINEAR_ISSUE_ID and LINEAR_ISSUE_IDENTIFIER.

### Status Workflow

**Important status rules:**
- After posting a comment with a question → set status to "Feedback Needed"
- After receiving feedback and resuming work → set status to "Building"
- When implementation is complete → set status to "Review"
- The user will see status changes in Linear, so always update status when your state changes

### Git Branch

You are working in branch \`issue/${issue.identifier}\`. All commits go to this branch.

### Workflow

**FIRST:** Set status to Building immediately:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "0aab3254-cc63-4979-84ab-eda800979c94"
\`\`\`

Then:
1. **Analyze**: Read the requirements. Post a comment with your implementation plan.
2. **Implement**: Write the code with tests. Commit your changes.
3. **If you need input**: Post a comment with your question AND set status to "Feedback Needed".

**WHEN DONE:** Push branch and create PR:
\`\`\`bash
git push -u origin issue/${issue.identifier}
gh pr create --title "${issue.identifier}: ${issue.title}" --body "Resolves ${issue.identifier}

Linear: https://linear.app/ona/issue/${issue.identifier}"
\`\`\`

**LAST:** Set status to Review and post PR link:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "e5708707-32a0-4ede-9f24-fb525d92b3d4"
linear-cli comments create --body "**🤖 Claude:** PR created: <paste PR URL here>" ${issue.identifier}
\`\`\`

### Important

- Always communicate your progress via Linear comments using \`linear-cli comments create\`
- Always update the issue status to reflect your current state using \`linear-cli issues update\`
- Keep the human in the loop—post meaningful updates, not just status changes
${profileSection}`.trim();
}

function buildProfileSection(profile?: AgentProfile): string {
  if (!profile?.promptAdditions?.length) {
    return "";
  }

  return `

### Profile Capabilities

${profile.promptAdditions.join("\n\n")}
`;
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

${authorName} has replied.

**FIRST:** Set status to Building:
\`\`\`bash
linear-cli issues update ${comment.issue.identifier} --state "0aab3254-cc63-4979-84ab-eda800979c94"
\`\`\`

Then:
1. **Read and understand** the feedback
2. **Post a comment** acknowledging their input (always prefix with \`**🤖 Claude:**\`):
   \`\`\`bash
   linear-cli comments create --body "**🤖 Claude:** Your response here" ${comment.issue.identifier}
   \`\`\`
3. **Do the work** they requested

**WHEN DONE:** Push branch and create/update PR:
\`\`\`bash
git push -u origin issue/${comment.issue.identifier}
# Create PR if not exists, or just push if PR already open
gh pr create --title "${comment.issue.identifier}: ${comment.issue.title}" --body "Resolves ${comment.issue.identifier}" 2>/dev/null || echo "PR already exists"
\`\`\`

**LAST:** Set status to Review:
\`\`\`bash
linear-cli issues update ${comment.issue.identifier} --state "e5708707-32a0-4ede-9f24-fb525d92b3d4"
\`\`\`

If you have questions, set status to Feedback Needed instead:
\`\`\`bash
linear-cli issues update ${comment.issue.identifier} --state "38ab3462-5550-4dcf-a1dd-6845e3a1e963"
\`\`\`
`.trim();
}

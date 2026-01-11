// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue, LinearComment, AgentProfile } from "./types";
import type { PersistedAgentState } from "./persistence";

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
| Planning | \`260a76bf-dc1f-46ee-9c59-518c9558e7bb\` |
| Feedback Needed | \`38ab3462-5550-4dcf-a1dd-6845e3a1e963\` |
| Building | \`0aab3254-cc63-4979-84ab-eda800979c94\` |
| Review | \`e5708707-32a0-4ede-9f24-fb525d92b3d4\` |
| Done | \`edbec4af-dc30-4d27-a122-84395ac3b885\` |

**Issue details:**
- Issue ID: ${issue.id}
- Issue identifier: ${issue.identifier}

These are also available as environment variables: LINEAR_ISSUE_ID and LINEAR_ISSUE_IDENTIFIER.

### Status Workflow

The workflow has distinct phases:
1. **Planning** → Analyze requirements, create implementation plan
2. **Feedback Needed** → Present plan to user, wait for approval
3. **Building** → Implement after user approves (only entered via user feedback)
4. **Review** → Work complete, PR created

### Git Branch

You are working in branch \`issue/${issue.identifier}\`. All commits go to this branch.

### Workflow (Planning Phase)

You are currently in the **Planning** phase. Do NOT start building yet.

**Step 1:** Announce you're starting planning:
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** Starting to analyze this issue and create an implementation plan." ${issue.identifier}
\`\`\`

**Step 2:** Analyze the requirements thoroughly:
- Read and understand the issue description
- Explore the codebase to understand the context
- Identify files that need to be modified
- Consider edge cases and potential challenges

**Step 3:** Post your implementation plan as a comment:
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Please review and let me know if you'd like any changes to this plan." ${issue.identifier}
\`\`\`

**Step 4:** Set status to Feedback Needed and STOP:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "38ab3462-5550-4dcf-a1dd-6845e3a1e963"
\`\`\`

**IMPORTANT:** After setting status to "Feedback Needed", STOP and wait for the user to respond. Do NOT proceed to building until the user provides feedback approving your plan.

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

${authorName} has provided feedback on your plan or work.

**First, determine the nature of the feedback:**
- If they **approved your plan** or said to proceed → Go to Building phase
- If they **requested changes to the plan** → Update your plan and stay in Feedback Needed
- If they **asked a question** → Answer it and stay in Feedback Needed

**If approved to build:**

1. Set status to Building:
\`\`\`bash
linear-cli issues update ${comment.issue.identifier} --state "0aab3254-cc63-4979-84ab-eda800979c94"
linear-cli comments create --body "**🤖 Claude:** Starting implementation based on the approved plan." ${comment.issue.identifier}
\`\`\`

2. Implement the plan - write code, tests, commit changes

3. When done, push and create PR:
\`\`\`bash
git push -u origin issue/${comment.issue.identifier}
gh pr create --title "${comment.issue.identifier}: ${comment.issue.title}" --body "Resolves ${comment.issue.identifier}

Linear: https://linear.app/ona/issue/${comment.issue.identifier}" 2>/dev/null || echo "PR already exists, pushing updates"
\`\`\`

4. Set status to Review:
\`\`\`bash
linear-cli issues update ${comment.issue.identifier} --state "e5708707-32a0-4ede-9f24-fb525d92b3d4"
linear-cli comments create --body "**🤖 Claude:** Implementation complete. PR created/updated and ready for review." ${comment.issue.identifier}
\`\`\`

**If plan changes requested or you have questions:**

Post your response and keep status at Feedback Needed:
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** [Your updated plan or answer to their question]" ${comment.issue.identifier}
linear-cli issues update ${comment.issue.identifier} --state "38ab3462-5550-4dcf-a1dd-6845e3a1e963"
\`\`\`
`.trim();
}

export function buildRecoveryPrompt(
  issue: LinearIssue,
  savedState: PersistedAgentState,
  profile?: AgentProfile
): string {
  const profileSection = buildProfileSection(profile);

  return `
## Agent Recovery - Resuming Work on ${issue.identifier}

**IMPORTANT:** You are recovering from a crash and resuming work on this issue.

**Issue**: ${issue.identifier} - ${issue.title}
**Issue ID**: ${issue.id}
**Last Known Status**: ${savedState.linearState ?? "Unknown"}

### Description
${issue.description || "No description provided."}

### Recovery Instructions

You were previously working on this issue but your session crashed. Here's what you need to do:

**Step 1:** Check the current state of your code:
\`\`\`bash
git status
git log --oneline -10
git diff HEAD~3..HEAD --stat
\`\`\`

**Step 2:** Fetch the full issue history from Linear (comments are your source of truth):
\`\`\`bash
linear-cli issues get ${issue.identifier}
\`\`\`

**Step 3:** Post a recovery comment to Linear:
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** Recovering from a session restart. Reviewing the issue history and git state to resume work." ${issue.identifier}
\`\`\`

**Step 4:** Based on the Linear comments and git history, determine where you left off and continue.

### How to Communicate with Linear

Use the \`linear-cli\` command line tool for all Linear interactions.

**Post a comment:**
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** Your message here" ${issue.identifier}
\`\`\`

**Update status:**
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "<state-id>"
\`\`\`

**State IDs:**
| Status | State ID |
|--------|----------|
| Planning | \`260a76bf-dc1f-46ee-9c59-518c9558e7bb\` |
| Feedback Needed | \`38ab3462-5550-4dcf-a1dd-6845e3a1e963\` |
| Building | \`0aab3254-cc63-4979-84ab-eda800979c94\` |
| Review | \`e5708707-32a0-4ede-9f24-fb525d92b3d4\` |
| Done | \`edbec4af-dc30-4d27-a122-84395ac3b885\` |

### Git Branch

You are working in branch \`issue/${issue.identifier}\`. All commits go to this branch.

### Important

- Linear comments are your source of truth for what was planned and discussed
- Git history shows what code was actually written
- Always communicate your progress via Linear comments
- Always update the issue status to reflect your current state
${profileSection}`.trim();
}

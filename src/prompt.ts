// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue, LinearComment, AgentProfile } from "./types";

export function isYoloMode(issue: LinearIssue): boolean {
  return issue.description?.toLowerCase().includes("yolo") ?? false;
}

export function buildPrompt(
  issue: LinearIssue,
  profile?: AgentProfile,
  workspace?: string
): string {
  const profileSection = buildProfileSection(profile);
  const yolo = isYoloMode(issue);
  const notificationSection = buildNotificationSection(workspace, issue.identifier);
  const workflowSection = buildWorkflowSection(issue, yolo, notificationSection);

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

### Git Branch

You are working in branch \`issue/${issue.identifier}\`. All commits go to this branch.
${workflowSection}
### Important

- Always communicate your progress via Linear comments using \`linear-cli comments create\`
- Always update the issue status to reflect your current state using \`linear-cli issues update\`
- Keep the human in the loop—post meaningful updates, not just status changes
${profileSection}`.trim();
}

function buildWorkflowSection(issue: LinearIssue, yolo: boolean, notificationSection: string): string {
  if (yolo) {
    return `
### Status Workflow (YOLO Mode)

**YOLO mode is active.** You will proceed directly to implementation after planning, without waiting for user approval.

The workflow phases:
1. **Planning** → Analyze requirements, create implementation plan
2. **Building** → Proceed immediately to implement
3. **Review** → Work complete, PR created

### Workflow (YOLO Mode)

**Step 1:** Announce you're starting:
\`\`\`bash
linear-cli comments create --body "**🤖 Claude:** Starting to analyze this issue. YOLO mode active - will proceed to implementation after planning." ${issue.identifier}
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

Proceeding to implementation (YOLO mode)." ${issue.identifier}
\`\`\`

**Step 4:** Set status to Building and proceed to implement immediately:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "0aab3254-cc63-4979-84ab-eda800979c94"
\`\`\`

**Step 5:** Implement the plan - write code, tests, commit changes

**Step 6:** When done, push and create PR:
\`\`\`bash
git push -u origin issue/${issue.identifier}
gh pr create --title "${issue.identifier}: ${issue.title}" --body "Resolves ${issue.identifier}

Linear: https://linear.app/ona/issue/${issue.identifier}" 2>/dev/null || echo "PR already exists, pushing updates"
\`\`\`

**Step 7:** Set status to Review:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "e5708707-32a0-4ede-9f24-fb525d92b3d4"
linear-cli comments create --body "**🤖 Claude:** Implementation complete. PR created/updated and ready for review." ${issue.identifier}
\`\`\`

**NOTE:** If you encounter a situation where you genuinely need user input (unclear requirements, major architectural decision, etc.), you may set status to Feedback Needed and wait.
`;
  }

  return `
### Status Workflow

The workflow has distinct phases:
1. **Planning** → Analyze requirements, create implementation plan
2. **Feedback Needed** → Present plan to user, wait for approval
3. **Building** → Implement after user approves (only entered via user feedback)
4. **Review** → Work complete, PR created

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
${notificationSection}
**IMPORTANT:** After setting status to "Feedback Needed", STOP and wait for the user to respond. Do NOT proceed to building until the user provides feedback approving your plan.
`;
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

function buildNotificationSection(
  workspace?: string,
  issueIdentifier?: string
): string {
  if (!workspace) {
    return "";
  }

  return `
**Notify the issue creator:** Before setting the status, @mention the issue creator so they receive an inbox notification:

1. Get the issue creator's info:
\`\`\`bash
linear-cli issues get ${issueIdentifier ?? "<identifier>"} -o json
\`\`\`

2. Find the creator/assignee email (e.g., \`mberg@ona.io\`) and extract the username prefix (e.g., \`mberg\`)

3. Include a mention in your plan comment by adding the profile URL:
\`\`\`
https://linear.app/${workspace}/profiles/<username> please review this plan.
\`\`\`

Linear will convert this URL to an @mention, triggering an inbox notification for the user.
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

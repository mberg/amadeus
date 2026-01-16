// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Formats issue details into actionable instructions for the agent.

import type { LinearIssue, LinearComment, AgentProfile } from "./types";
import type { PersistedAgentState } from "./persistence";
import type { FetchedComment } from "./linear";

export function isYoloMode(issue: LinearIssue): boolean {
  return issue.description?.toLowerCase().includes("yolo") ?? false;
}

export function buildPrompt(
  issue: LinearIssue,
  profile?: AgentProfile,
  workspace?: string,
  agentName: string = "Amadeus",
  githubRepoUrl?: string,
  existingComments?: FetchedComment[]
): string {
  const profileSection = buildProfileSection(profile);
  const yolo = isYoloMode(issue);
  const notificationSection = buildNotificationSection(workspace, issue.identifier);
  const workflowSection = buildWorkflowSection(issue, yolo, notificationSection, agentName, workspace);
  const fileLinkingSection = buildFileLinkingSection(githubRepoUrl, issue.identifier);
  const commentHistorySection = buildCommentHistorySection(existingComments);

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
linear-cli comments create --body "**🤖 ${agentName}:** Your message here" ${issue.identifier}
\`\`\`
**Important:** Always prefix your comments with \`**🤖 ${agentName}:**\` so users know it's from the AI agent.

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
${fileLinkingSection}${workflowSection}
### CRITICAL - User Communication

**⚠️ THE USER CANNOT SEE YOUR TERMINAL OUTPUT ⚠️**

The user can ONLY see messages you post to Linear. Your thoughts, questions, reasoning, and terminal output are completely invisible to them.

**If you need to communicate ANYTHING to the user:**
1. Ask a clarifying question → **POST IT TO LINEAR** via \`linear-cli comments create\`
2. Share your analysis or findings → **POST IT TO LINEAR**
3. Request feedback or approval → **POST IT TO LINEAR**
4. Report progress or blockers → **POST IT TO LINEAR**

**DO NOT:**
- Output questions to the terminal and wait for a response (user won't see it)
- Assume the user can read your internal monologue
- Skip posting to Linear because you already "said" something in your output

**DO:**
- Use \`linear-cli comments create --body "**🤖 ${agentName}:** your message" ${issue.identifier}\`
- Update status to "Feedback Needed" when waiting for user input
- STOP and wait after posting questions (don't keep working)

**REMEMBER:** If you don't run \`linear-cli comments create\`, the user will never see your message. Period.
${commentHistorySection}${profileSection}`.trim();
}

function buildWorkflowSection(issue: LinearIssue, yolo: boolean, notificationSection: string, agentName: string, workspace?: string): string {
  const reviewNotificationSection = workspace ? `
**Step 7:** Notify the issue creator by assigning the issue to them:
\`\`\`bash
linear-cli issues get ${issue.identifier} -o json
\`\`\`
Find the creator's email and assign:
\`\`\`bash
linear-cli issues update ${issue.identifier} --assignee "<email>"
\`\`\`

This triggers an inbox notification that the PR is ready for review.
` : "";

  if (yolo) {
    return `
### Status Workflow (YOLO Mode)

**YOLO mode is active.** You will proceed directly to implementation after planning, without waiting for user approval.

The workflow phases:
1. **Planning** → Analyze requirements, create implementation plan
2. **Building** → Proceed immediately to implement
3. **Review** → Work complete, PR created

### Workflow (YOLO Mode)

**Note:** The issue has already been acknowledged automatically. Proceed with the workflow below.

**Step 1:** Analyze the requirements thoroughly:
- Read and understand the issue description
- Explore the codebase to understand the context
- Identify files that need to be modified
- Consider edge cases and potential challenges

**Step 2:** Post your implementation plan as a comment:
\`\`\`bash
linear-cli comments create --body "**🤖 ${agentName}:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Proceeding to implementation (YOLO mode)." ${issue.identifier}
\`\`\`

**Step 3:** Set status to Building and proceed to implement immediately:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "0aab3254-cc63-4979-84ab-eda800979c94"
\`\`\`

**Step 4:** Implement the plan - write code, tests, commit changes

**Step 5:** When done, push and create PR:
\`\`\`bash
git push -u origin issue/${issue.identifier}
gh pr create --title "${issue.identifier}: ${issue.title}" --body "Resolves ${issue.identifier}

Linear: https://linear.app/ona/issue/${issue.identifier}" 2>/dev/null || echo "PR already exists, pushing updates"
\`\`\`

**Step 6:** Set status to Review:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "e5708707-32a0-4ede-9f24-fb525d92b3d4"
linear-cli comments create --body "**🤖 ${agentName}:** Implementation complete. PR created/updated and ready for review." ${issue.identifier}
\`\`\`
${reviewNotificationSection}
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

**Note:** The issue has already been acknowledged automatically. Proceed with the workflow below.

**Step 1:** Analyze the requirements thoroughly:
- Read and understand the issue description
- Explore the codebase to understand the context
- Identify files that need to be modified
- Consider edge cases and potential challenges

**Step 2:** Post your implementation plan as a comment:
\`\`\`bash
linear-cli comments create --body "**🤖 ${agentName}:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Please review and let me know if you'd like any changes to this plan." ${issue.identifier}
\`\`\`

**Step 3:** Set status to Feedback Needed and STOP:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "38ab3462-5550-4dcf-a1dd-6845e3a1e963"
\`\`\`
${notificationSection}
**IMPORTANT:** After setting status to "Feedback Needed", STOP and wait for the user to respond. Do NOT proceed to building until the user provides feedback approving your plan.
${reviewNotificationSection ? `
### When Setting Status to Review

After the user approves and you complete implementation:
1. Push your changes and create a PR
2. Set status to Review
3. Notify the issue creator by assigning the issue to them (same process as above with \`--assignee\`)

This ensures they receive an inbox notification that the PR is ready for review.
` : ""}`;
}

function buildFileLinkingSection(githubRepoUrl?: string, issueIdentifier?: string): string {
  if (!githubRepoUrl || !issueIdentifier) {
    return "";
  }

  const branch = `issue/${issueIdentifier}`;
  const exampleUrl = `${githubRepoUrl}/blob/${branch}/README.md`;

  return `
### File References in Comments

When referencing files in Linear comments, use full GitHub URLs so they are clickable:
- Format: \`[filename](${githubRepoUrl}/blob/${branch}/path/to/file)\`
- Example: \`[README.md](${exampleUrl})\`

This ensures file references link directly to the code on GitHub.
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

function buildCommentHistorySection(comments?: FetchedComment[]): string {
  if (!comments || comments.length === 0) {
    return "";
  }

  const formattedComments = comments.map((c) => {
    const date = new Date(c.createdAt).toLocaleString();
    return `**${c.authorName}** (${date}):\n${c.body}`;
  }).join("\n\n---\n\n");

  return `

### Previous Discussion

This issue has existing comments from previous work. Review this history to understand what has been discussed and decided:

${formattedComments}

---

**Important:** If you see comments from a previous agent session (prefixed with 🤖), that agent may have crashed. Review what was planned or done and continue from where they left off rather than starting from scratch.
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
**Notify the issue creator:** After posting your plan, assign the issue to the creator to trigger an inbox notification:

1. Get the issue creator's info:
\`\`\`bash
linear-cli issues get ${issueIdentifier ?? "<identifier>"} -o json
\`\`\`

2. Find the creator's email (e.g., \`mberg@ona.io\`)

3. Assign the issue to them:
\`\`\`bash
linear-cli issues update ${issueIdentifier ?? "<identifier>"} --assignee "<email>"
\`\`\`

This triggers a reliable inbox notification for the user.
`;
}

export function buildCommentPrompt(comment: LinearComment): string {
  const authorName = comment.user?.name ?? "The user";

  return `
## New Comment from ${authorName}

${comment.body}

---

Respond based on the feedback type:
- **Approved** → Set status to Building, implement, then create PR and set to Review
- **Changes requested** → Update plan, stay in Feedback Needed
- **Question** → Answer it, stay in Feedback Needed

Use the state IDs and commands from your initial instructions.
`.trim();
}

export function buildRecoveryPrompt(
  issue: LinearIssue,
  savedState: PersistedAgentState,
  profile?: AgentProfile,
  agentName: string = "Amadeus"
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
linear-cli comments create --body "**🤖 ${agentName}:** Recovering from a session restart. Reviewing the issue history and git state to resume work." ${issue.identifier}
\`\`\`

**Step 4:** Based on the Linear comments and git history, determine where you left off and continue.

### How to Communicate with Linear

Use the \`linear-cli\` command line tool for all Linear interactions.

**Post a comment:**
\`\`\`bash
linear-cli comments create --body "**🤖 ${agentName}:** Your message here" ${issue.identifier}
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

### CRITICAL - User Communication

**⚠️ THE USER CANNOT SEE YOUR TERMINAL OUTPUT ⚠️**

The user can ONLY see messages you post to Linear. If you need to ask questions, share findings, or report progress, you MUST post them via \`linear-cli comments create\` - otherwise the user will never see them.

**DO NOT** output questions to the terminal and wait - post them to Linear first!

- Linear comments are your source of truth for what was planned and discussed
- Git history shows what code was actually written
- Always communicate your progress via Linear comments
- Always update the issue status to reflect your current state
${profileSection}`.trim();
}

// ABOUTME: Builds Claude prompts from Linear issue data.
// ABOUTME: Supports editable prompt templates with {{variable}} substitution.

import type { LinearIssue, LinearComment, AgentProfile, WorkflowState } from "./types";
import type { PersistedAgentState } from "./persistence";
import type { FetchedComment } from "./linear";

/**
 * Default prompt template with {{variable}} placeholders.
 * This is the template used when no custom template is set on the realm.
 * Admins can edit this per-realm via the admin UI.
 *
 * Available variables:
 *   {{issueIdentifier}}        - e.g. "ONA-2118"
 *   {{issueTitle}}             - issue title
 *   {{issueId}}                - issue UUID
 *   {{issuePriority}}          - priority number or "None"
 *   {{issueLabels}}            - comma-separated labels or "None"
 *   {{issueDescription}}       - issue body text
 *   {{agentName}}              - e.g. "Amadeus"
 *   {{stateIdTable}}           - rendered state ID table
 *   {{feedbackNeededStateId}}  - state ID for "Feedback Needed"
 *   {{buildingStateId}}        - state ID for "Building"
 *   {{reviewStateId}}          - state ID for "Review"
 *   {{gitBranch}}              - e.g. "issue/ONA-2118"
 *   {{fileLinkingSection}}     - file reference instructions (if GitHub URL available)
 *   {{commentHistorySection}}  - previous discussion history
 *   {{profileSection}}         - profile capabilities
 *   {{notificationSection}}    - creator notification instructions
 *   {{reviewNotificationSection}} - review notification instructions
 *   {{screenshotSection}}         - screenshot instructions for UI work
 */
export const DEFAULT_PROMPT_TEMPLATE = `## New Task from Linear

**Issue**: {{issueIdentifier}} - {{issueTitle}}
**Issue ID**: {{issueId}}
**Priority**: {{issuePriority}}
**Labels**: {{issueLabels}}

### Description
{{issueDescription}}

### How to Communicate with Linear

Use the \`linear-cli\` command line tool for all Linear interactions.

**Post a comment:**
\`\`\`bash
linear-cli comments create --body "**🤖 {{agentName}}:** Your message here" {{issueIdentifier}}
\`\`\`
**Important:** Always prefix your comments with \`**🤖 {{agentName}}:**\` so users know it's from the AI agent.

**Update status:**
\`\`\`bash
linear-cli issues update {{issueIdentifier}} --state "<state-id>"
\`\`\`

**State IDs:**
{{stateIdTable}}

**Issue details:**
- Issue ID: {{issueId}}
- Issue identifier: {{issueIdentifier}}

These are also available as environment variables: LINEAR_ISSUE_ID and LINEAR_ISSUE_IDENTIFIER.

### Git Branch

You are working in branch \`issue/{{issueIdentifier}}\`. All commits go to this branch.
{{fileLinkingSection}}
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
linear-cli comments create --body "**🤖 {{agentName}}:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Please review and let me know if you'd like any changes to this plan." {{issueIdentifier}}
\`\`\`

**Step 3:** Set status to Feedback Needed and STOP:
\`\`\`bash
linear-cli issues update {{issueIdentifier}} --state "{{feedbackNeededStateId}}"
\`\`\`
{{notificationSection}}
**IMPORTANT:** After setting status to "Feedback Needed", STOP and wait for the user to respond. Do NOT proceed to building until the user provides feedback approving your plan.
{{reviewNotificationSection}}
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
- Use \`linear-cli comments create --body "**🤖 {{agentName}}:** your message" {{issueIdentifier}}\`
- Update status to "Feedback Needed" when waiting for user input
- STOP and wait after posting questions (don't keep working)

**REMEMBER:** If you don't run \`linear-cli comments create\`, the user will never see your message. Period.
{{screenshotSection}}{{commentHistorySection}}{{profileSection}}`;

/**
 * Render a prompt template by substituting {{variable}} placeholders.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match;
  });
}

/**
 * Build the template variables from issue data and context.
 */
export function buildTemplateVariables(
  issue: LinearIssue,
  profile?: AgentProfile,
  workspace?: string,
  agentName: string = "Amadeus",
  githubRepoUrl?: string,
  existingComments?: FetchedComment[],
  workflowStates?: WorkflowState[]
): Record<string, string> {
  return {
    issueIdentifier: issue.identifier,
    issueTitle: issue.title,
    issueId: issue.id,
    issuePriority: String(issue.priority ?? "None"),
    issueLabels: issue.labels?.map((l) => l.name).join(", ") || "None",
    issueDescription: issue.description || "No description provided.",
    agentName,
    stateIdTable: workflowStates?.length
      ? buildStateIdTable(workflowStates)
      : `*Use \`linear-cli statuses list --team <team>\` to find state IDs.*`,
    feedbackNeededStateId: getStateId(workflowStates, "Feedback Needed"),
    buildingStateId: getStateId(workflowStates, "Building"),
    reviewStateId: getStateId(workflowStates, "Review"),
    gitBranch: `issue/${issue.identifier}`,
    fileLinkingSection: buildFileLinkingSection(githubRepoUrl, issue.identifier),
    commentHistorySection: buildCommentHistorySection(existingComments),
    profileSection: buildProfileSection(profile),
    notificationSection: buildNotificationSection(workspace, issue.identifier),
    reviewNotificationSection: buildReviewNotificationSection(workspace, issue.identifier),
    screenshotSection: buildScreenshotSection(issue.identifier),
  };
}

/**
 * Build the state ID table from workflow states.
 * Maps common workflow state names to their IDs.
 */
function buildStateIdTable(states: WorkflowState[]): string {
  // Define the states we care about showing in the prompt
  const stateNames = ["Planning", "Feedback Needed", "Building", "Review", "Done"];

  const rows = stateNames
    .map(name => {
      const state = states.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (state) {
        return `| ${name} | \`${state.id}\` |`;
      }
      return null;
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return `*State IDs not available. Use \`linear-cli statuses list --team <team>\` to find them.*`;
  }

  return `| Status | State ID |
|--------|----------|
${rows.join("\n")}`
}

/**
 * Get state ID by name, with fallback placeholder.
 */
function getStateId(states: WorkflowState[] | undefined, name: string): string {
  const state = states?.find(s => s.name.toLowerCase() === name.toLowerCase());
  return state?.id ?? `<${name.toLowerCase().replace(/\s+/g, "-")}-state-id>`;
}

export function isYoloMode(issue: LinearIssue): boolean {
  return issue.description?.toLowerCase().includes("yolo") ?? false;
}

export function hasUltrathinkLabel(issue: LinearIssue): boolean {
  return issue.labels?.some((l) => l.name.toLowerCase() === "ultrathink") ?? false;
}

export function buildPrompt(
  issue: LinearIssue,
  profile?: AgentProfile,
  workspace?: string,
  agentName: string = "Amadeus",
  githubRepoUrl?: string,
  existingComments?: FetchedComment[],
  workflowStates?: WorkflowState[],
  promptTemplate?: string | null
): string {
  const yolo = isYoloMode(issue);
  const ultrathink = hasUltrathinkLabel(issue);
  const ultrathinkPrefix = ultrathink ? "ultrathink\n\n" : "";

  // If a custom prompt template is set and NOT in YOLO mode, use the template
  if (promptTemplate && !yolo) {
    const variables = buildTemplateVariables(
      issue, profile, workspace, agentName, githubRepoUrl, existingComments, workflowStates
    );
    return `${ultrathinkPrefix}${renderTemplate(promptTemplate, variables)}`.trim();
  }

  // Fall back to the code-driven prompt (original logic)
  const profileSection = buildProfileSection(profile);
  const notificationSection = buildNotificationSection(workspace, issue.identifier);
  const workflowSection = buildWorkflowSection(issue, yolo, notificationSection, agentName, workspace, workflowStates);
  const fileLinkingSection = buildFileLinkingSection(githubRepoUrl, issue.identifier);
  const commentHistorySection = buildCommentHistorySection(existingComments);

  return `${ultrathinkPrefix}
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
${workflowStates?.length ? buildStateIdTable(workflowStates) : `*Use \`linear-cli statuses list --team <team>\` to find state IDs.*`}

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
${buildScreenshotSection(issue.identifier)}${commentHistorySection}${profileSection}`.trim();
}

function buildWorkflowSection(issue: LinearIssue, yolo: boolean, notificationSection: string, agentName: string, workspace?: string, workflowStates?: WorkflowState[]): string {
  const reviewNotificationSection = workspace ? `
**Step 7:** Notify the issue creator by assigning the issue to them:
\`\`\`bash
linear-cli users list
\`\`\`
Find the creator's user ID (UUID), then assign:
\`\`\`bash
linear-cli issues update ${issue.identifier} --assignee "<user-uuid>"
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
linear-cli issues update ${issue.identifier} --state "${getStateId(workflowStates, "Building")}"
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
linear-cli issues update ${issue.identifier} --state "${getStateId(workflowStates, "Review")}"
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
linear-cli issues update ${issue.identifier} --state "${getStateId(workflowStates, "Feedback Needed")}"
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

function buildScreenshotSection(issueIdentifier: string): string {
  return `

### Screenshots of Completed Work

When your work involves **visible UI changes** (frontend components, pages, dashboards, styling, etc.), take a screenshot after implementation to show the result.

**How to take and post screenshots:**

1. Use Playwright to navigate to the relevant page and take a screenshot:
\`\`\`
Use the browser_navigate and browser_take_screenshot MCP tools to capture the result.
Save the screenshot to a local file path (e.g., /tmp/screenshot.png).
\`\`\`

2. Upload the screenshot to Linear:
\`\`\`bash
SCREENSHOT_URL=$(bun scripts/upload-to-linear.ts /tmp/screenshot.png)
\`\`\`

3. Include the screenshot in your Linear comment:
\`\`\`bash
linear-cli comments create --body "**🤖 Amadeus:** Implementation complete. Here's what it looks like:

![Screenshot]($SCREENSHOT_URL)" ${issueIdentifier}
\`\`\`

**When to take screenshots:**
- After completing UI/frontend changes
- When the issue involves visual design or layout work
- To demonstrate a bug fix that affects what users see

**When NOT to take screenshots:**
- Backend-only changes (APIs, database, configs)
- Code refactoring with no visual impact
- CI/CD or infrastructure changes
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

1. List users to find the creator's UUID:
\`\`\`bash
linear-cli users list
\`\`\`

2. Assign the issue using their UUID:
\`\`\`bash
linear-cli issues update ${issueIdentifier ?? "<identifier>"} --assignee "<user-uuid>"
\`\`\`

This triggers a reliable inbox notification for the user.
`;
}

function buildReviewNotificationSection(
  workspace?: string,
  issueIdentifier?: string
): string {
  if (!workspace) {
    return "";
  }

  return `
### When Setting Status to Review

After the user approves and you complete implementation:
1. Push your changes and create a PR
2. Set status to Review
3. Notify the issue creator by assigning the issue to them:

\`\`\`bash
linear-cli users list
\`\`\`
Find the creator's user ID (UUID), then assign:
\`\`\`bash
linear-cli issues update ${issueIdentifier ?? "<identifier>"} --assignee "<user-uuid>"
\`\`\`

This ensures they receive an inbox notification that the PR is ready for review.
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
  agentName: string = "Amadeus",
  workflowStates?: WorkflowState[]
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
${workflowStates?.length ? buildStateIdTable(workflowStates) : `*Use \`linear-cli statuses list --team <team>\` to find state IDs.*`}

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

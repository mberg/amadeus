// ABOUTME: GitHub issue tracking provider implementation.
// ABOUTME: Handles GitHub webhooks, issue operations, and prompt building.

import { $ } from "bun";
import { timingSafeEqual } from "crypto";
import type { AgentProfile } from "../types";
import type { PersistedAgentState } from "../persistence";
import type {
  IssueTrackingProvider,
  ParsedIssue,
  ParsedComment,
  ParsedWebhook,
  FetchedComment,
  WorkflowStates,
  ProviderConfig,
} from "./types";

// GitHub Projects column names (these are created by user in their project)
const GITHUB_STATES: WorkflowStates = {
  planning: "Planning",
  feedbackNeeded: "Feedback Needed",
  building: "Building",
  review: "Review",
  done: "Done",
};

// Label names for fallback when no project is configured
const STATUS_LABELS = {
  planning: "status:planning",
  feedbackNeeded: "status:feedback-needed",
  building: "status:building",
  review: "status:review",
};

const MAX_WEBHOOK_AGE_MS = 300000; // 5 minutes tolerance (GitHub webhooks can be delayed)

/**
 * GitHub issue tracking provider.
 */
export class GitHubProvider implements IssueTrackingProvider {
  readonly type = "github" as const;
  readonly realmName: string;
  readonly agentName: string;

  private readonly owner: string;
  private readonly repo: string;
  private readonly projectNumber?: number;
  private readonly token: string;
  private readonly webhookSecret: string;
  private readonly triggerStates: string[];
  private readonly botUserId?: string;

  constructor(config: ProviderConfig) {
    if (config.type !== "github") {
      throw new Error(`GitHubProvider requires type 'github', got '${config.type}'`);
    }
    if (!config.githubOwner) {
      throw new Error("GitHubProvider requires githubOwner");
    }
    if (!config.githubRepo) {
      throw new Error("GitHubProvider requires githubRepo");
    }
    if (!config.githubToken) {
      throw new Error("GitHubProvider requires githubToken");
    }
    if (!config.githubWebhookSecret) {
      throw new Error("GitHubProvider requires githubWebhookSecret");
    }

    this.realmName = config.realmName;
    this.agentName = config.agentName ?? "Amadeus";
    this.owner = config.githubOwner;
    this.repo = config.githubRepo;
    this.projectNumber = config.githubProjectNumber;
    this.token = config.githubToken;
    this.webhookSecret = config.githubWebhookSecret;
    this.triggerStates = config.triggerStates ?? ["Planning"];
    this.botUserId = config.botUserId;
  }

  // ─────────────────────────────────────────────────────────────────
  // Webhook handling
  // ─────────────────────────────────────────────────────────────────

  async verifyWebhook(payload: string, signature: string | null): Promise<boolean> {
    if (!signature || !this.webhookSecret) return false;

    // GitHub uses sha256=<signature> format
    const parts = signature.split("=");
    if (parts.length !== 2 || parts[0] !== "sha256") {
      return false;
    }
    const receivedSig = parts[1];

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expectedSignature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const signatureBuffer = Buffer.from(receivedSig, "hex");

    if (expectedBuffer.length !== signatureBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  parseWebhook(payload: string): ParsedWebhook {
    const data = JSON.parse(payload);
    const action = data.action as string;

    // Issue events
    if (data.issue && !data.comment) {
      const ghAction = this.mapGitHubAction(action);
      return {
        type: "issue",
        action: ghAction,
        issue: this.parseIssue(data.issue, data),
      };
    }

    // Issue comment events
    if (data.comment && data.issue) {
      const ghAction = this.mapGitHubAction(action);
      return {
        type: "comment",
        action: ghAction,
        comment: this.parseComment(data.comment, data.issue, data),
      };
    }

    return { type: "unknown", action };
  }

  validateTimestamp(payload: string): boolean {
    // GitHub doesn't include timestamp in payload, but webhook headers include
    // X-GitHub-Delivery which is a unique ID. For now, we accept all valid signatures.
    // In production, you might want to implement a delivery ID cache to prevent replays.
    return true;
  }

  private mapGitHubAction(action: string): "create" | "update" | "remove" {
    switch (action) {
      case "opened":
        return "create";
      case "created": // for comments
        return "create";
      case "edited":
      case "labeled":
      case "unlabeled":
      case "assigned":
      case "unassigned":
      case "milestoned":
      case "demilestoned":
      case "transferred":
        return "update";
      case "deleted":
      case "closed":
        return "remove";
      default:
        return "update";
    }
  }

  private parseIssue(issue: GitHubIssuePayload, webhookData: GitHubWebhookPayload): ParsedIssue {
    // Extract state from labels or project column
    const state = this.extractState(issue);

    return {
      id: String(issue.id),
      identifier: `#${issue.number}`,
      title: issue.title,
      description: issue.body ?? undefined,
      priority: undefined, // GitHub doesn't have native priority
      state,
      assignee: issue.assignee ? { id: String(issue.assignee.id) } : undefined,
      labels: issue.labels?.map((l) => ({ name: typeof l === "string" ? l : l.name })),
      teamKey: this.repo.toUpperCase(),
      projectName: webhookData.repository?.name,
      raw: { issue, webhookData },
    };
  }

  private parseComment(
    comment: GitHubCommentPayload,
    issue: GitHubIssuePayload,
    webhookData: GitHubWebhookPayload
  ): ParsedComment {
    return {
      id: String(comment.id),
      body: comment.body,
      issueId: String(issue.id),
      issue: this.parseIssue(issue, webhookData),
      author: comment.user
        ? { id: String(comment.user.id), name: comment.user.login }
        : undefined,
      createdAt: comment.created_at,
      raw: { comment, issue, webhookData },
    };
  }

  private extractState(issue: GitHubIssuePayload): { id: string; name: string; type?: string } {
    // Check for status labels first
    const labels = issue.labels ?? [];
    for (const label of labels) {
      const labelName = typeof label === "string" ? label : label.name;
      if (labelName === STATUS_LABELS.planning) {
        return { id: "planning", name: "Planning" };
      }
      if (labelName === STATUS_LABELS.feedbackNeeded) {
        return { id: "feedback-needed", name: "Feedback Needed" };
      }
      if (labelName === STATUS_LABELS.building) {
        return { id: "building", name: "Building" };
      }
      if (labelName === STATUS_LABELS.review) {
        return { id: "review", name: "Review" };
      }
    }

    // Check if issue is closed
    if (issue.state === "closed") {
      return { id: "done", name: "Done", type: "completed" };
    }

    // Default to open/planning
    return { id: "open", name: "Open" };
  }

  // ─────────────────────────────────────────────────────────────────
  // Issue operations
  // ─────────────────────────────────────────────────────────────────

  getAgentKey(issue: ParsedIssue): string {
    return `${this.repo}-${issue.id}`;
  }

  shouldStartAgent(issue: ParsedIssue): boolean {
    // Check if issue has the required agent label (case-insensitive)
    const agentNameLower = this.agentName.toLowerCase();
    const hasAgentLabel =
      issue.labels?.some((l) => l.name.toLowerCase() === agentNameLower) ?? false;

    if (!hasAgentLabel) {
      return false;
    }

    // Check if state matches trigger states
    const stateName = issue.state?.name ?? "";
    const stateMatch = this.triggerStates.some(
      (ts) => ts.toLowerCase() === stateName.toLowerCase()
    );

    // Check for planning label as trigger
    const hasPlanningLabel =
      issue.labels?.some((l) => l.name === STATUS_LABELS.planning) ?? false;

    return stateMatch || hasPlanningLabel;
  }

  shouldTerminateAgent(issue: ParsedIssue): boolean {
    const stateType = issue.state?.type?.toLowerCase() ?? "";
    const stateName = issue.state?.name?.toLowerCase() ?? "";

    return (
      stateType === "completed" ||
      stateName === "done" ||
      stateName === "closed"
    );
  }

  isAwaitingFeedback(issue: ParsedIssue): boolean {
    // Check if issue has the required agent label
    const agentNameLower = this.agentName.toLowerCase();
    const hasAgentLabel =
      issue.labels?.some((l) => l.name.toLowerCase() === agentNameLower) ?? false;

    if (!hasAgentLabel) {
      return false;
    }

    // Check for feedback needed label or state
    const hasFeedbackLabel =
      issue.labels?.some((l) => l.name === STATUS_LABELS.feedbackNeeded) ?? false;
    const stateName = issue.state?.name?.toLowerCase() ?? "";

    return hasFeedbackLabel || stateName === "feedback needed";
  }

  isDraft(issue: ParsedIssue): boolean {
    // GitHub doesn't have draft issues (only draft PRs)
    // Check for a "draft" label as convention
    return issue.labels?.some((l) => l.name.toLowerCase() === "draft") ?? false;
  }

  isBotComment(comment: ParsedComment): boolean {
    // Primary detection: check comment body for bot prefix
    const escaped = this.agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\*\\*🤖 ${escaped}:\\*\\*`);
    if (pattern.test(comment.body)) {
      return true;
    }

    // Secondary detection: user ID match
    if (this.botUserId && comment.author?.id === this.botUserId) {
      return true;
    }

    // Check for [bot] suffix in username (GitHub Apps)
    if (comment.author?.name?.endsWith("[bot]")) {
      return true;
    }

    return false;
  }

  getCompletionReason(issue: ParsedIssue): "done" | "stopped" | "canceled" | "backlog" {
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    const stateType = issue.state?.type?.toLowerCase() ?? "";

    if (stateType === "completed" || stateName === "done" || stateName === "closed") {
      return "done";
    }
    // GitHub doesn't have native canceled/backlog states
    // Check for labels
    const labels = issue.labels?.map((l) => l.name.toLowerCase()) ?? [];
    if (labels.includes("wontfix") || labels.includes("invalid")) {
      return "canceled";
    }
    if (labels.includes("backlog")) {
      return "backlog";
    }
    return "stopped";
  }

  // ─────────────────────────────────────────────────────────────────
  // State management
  // ─────────────────────────────────────────────────────────────────

  getWorkflowStates(): WorkflowStates {
    return GITHUB_STATES;
  }

  async updateIssueState(issueIdentifier: string, stateName: string): Promise<void> {
    const issueNumber = issueIdentifier.replace("#", "");
    const env = { ...process.env, GH_TOKEN: this.token };
    const repoArg = `${this.owner}/${this.repo}`;

    // Map state name to label
    const labelMap: Record<string, string> = {
      Planning: STATUS_LABELS.planning,
      "Feedback Needed": STATUS_LABELS.feedbackNeeded,
      Building: STATUS_LABELS.building,
      Review: STATUS_LABELS.review,
    };

    const newLabel = labelMap[stateName];

    if (stateName === "Done") {
      // Close the issue
      await $`gh issue close ${issueNumber} --repo ${repoArg}`.env(env).quiet();
      // Remove all status labels
      for (const label of Object.values(STATUS_LABELS)) {
        await $`gh issue edit ${issueNumber} --repo ${repoArg} --remove-label ${label}`.env(env).quiet().nothrow();
      }
    } else if (newLabel) {
      // Remove other status labels and add the new one
      for (const label of Object.values(STATUS_LABELS)) {
        if (label !== newLabel) {
          await $`gh issue edit ${issueNumber} --repo ${repoArg} --remove-label ${label}`.env(env).quiet().nothrow();
        }
      }
      await $`gh issue edit ${issueNumber} --repo ${repoArg} --add-label ${newLabel}`.env(env).quiet();
    }

    // If using GitHub Projects, also update the project item status
    if (this.projectNumber) {
      await this.updateProjectItemStatus(issueNumber, stateName);
    }
  }

  private async updateProjectItemStatus(issueNumber: string, stateName: string): Promise<void> {
    // This requires GraphQL API - for now, labels are the primary mechanism
    // TODO: Implement GitHub Projects GraphQL API integration
    console.log(`[GitHub] Project status update for #${issueNumber} to ${stateName} - using labels for now`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Comments
  // ─────────────────────────────────────────────────────────────────

  async fetchComments(issueId: string): Promise<FetchedComment[]> {
    const env = { ...process.env, GH_TOKEN: this.token };
    const repoArg = `${this.owner}/${this.repo}`;

    try {
      // We need the issue number, not the ID. Try to get it from the raw data or API.
      // For now, assume issueId is the issue number (we store it that way in parseIssue)
      const result = await $`gh api repos/${repoArg}/issues/${issueId}/comments --jq '.[] | {id: .id, body: .body, author: .user.login, createdAt: .created_at}'`
        .env(env)
        .quiet()
        .text();

      if (!result.trim()) {
        return [];
      }

      // Parse JSONL output
      const comments: FetchedComment[] = [];
      for (const line of result.trim().split("\n")) {
        if (line.trim()) {
          const c = JSON.parse(line);
          comments.push({
            id: String(c.id),
            body: c.body,
            authorName: c.author ?? "Unknown",
            createdAt: c.createdAt,
          });
        }
      }

      return comments.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    } catch (err) {
      console.warn("[GitHub] Error fetching comments:", err);
      return [];
    }
  }

  async postComment(issueIdentifier: string, body: string): Promise<void> {
    const issueNumber = issueIdentifier.replace("#", "");
    const env = { ...process.env, GH_TOKEN: this.token };
    const repoArg = `${this.owner}/${this.repo}`;

    await $`gh issue comment ${issueNumber} --repo ${repoArg} --body ${body}`.env(env).quiet();
  }

  async acknowledgeIssue(issueIdentifier: string): Promise<void> {
    const message = `**🤖 ${this.agentName}:** I've received the issue. Beginning the planning process.`;
    await this.postComment(issueIdentifier, message);
  }

  // ─────────────────────────────────────────────────────────────────
  // Prompt building
  // ─────────────────────────────────────────────────────────────────

  buildPrompt(
    issue: ParsedIssue,
    profile?: AgentProfile,
    githubRepoUrl?: string,
    existingComments?: FetchedComment[]
  ): string {
    const profileSection = this.buildProfileSection(profile);
    const yolo = issue.description?.toLowerCase().includes("yolo") ?? false;
    const workflowSection = this.buildWorkflowSection(issue, yolo);
    const fileLinkingSection = this.buildFileLinkingSection(issue.identifier);
    const commentHistorySection = this.buildCommentHistorySection(existingComments);
    const repoArg = `${this.owner}/${this.repo}`;
    const issueNumber = issue.identifier.replace("#", "");

    return `
## New Task from GitHub

**Issue**: ${issue.identifier} - ${issue.title}
**Repository**: ${repoArg}
**Labels**: ${issue.labels?.map((l) => l.name).join(", ") || "None"}

### Description
${issue.description || "No description provided."}

### How to Communicate with GitHub

Use the \`gh\` CLI tool for all GitHub interactions.

**Post a comment:**
\`\`\`bash
gh issue comment ${issueNumber} --repo ${repoArg} --body "**🤖 ${this.agentName}:** Your message here"
\`\`\`
**Important:** Always prefix your comments with \`**🤖 ${this.agentName}:**\` so users know it's from the AI agent.

**Update status (via labels):**
\`\`\`bash
# Remove old status and add new one
gh issue edit ${issueNumber} --repo ${repoArg} --remove-label "status:planning" --add-label "status:building"
\`\`\`

**Status Labels:**
| Status | Label |
|--------|-------|
| Planning | \`${STATUS_LABELS.planning}\` |
| Feedback Needed | \`${STATUS_LABELS.feedbackNeeded}\` |
| Building | \`${STATUS_LABELS.building}\` |
| Review | \`${STATUS_LABELS.review}\` |
| Done | Close the issue: \`gh issue close ${issueNumber} --repo ${repoArg}\` |

**Issue details:**
- Issue number: ${issueNumber}
- Repository: ${repoArg}

These are also available as environment variables: GITHUB_ISSUE_NUMBER and GITHUB_REPOSITORY.

### Git Branch

You are working in branch \`issue/${issue.identifier.replace("#", "")}\`. All commits go to this branch.
${fileLinkingSection}${workflowSection}
### Important - User Communication

**The user can ONLY see messages you send via GitHub comments.** Your internal thoughts, questions, and reasoning are invisible to them. If you need to:
- Ask a clarifying question → Post it as a GitHub comment
- Share your analysis or findings → Post it as a GitHub comment
- Request feedback or approval → Post it as a GitHub comment
- Report progress or blockers → Post it as a GitHub comment

Any thoughts or questions you don't post to GitHub will never reach the user. You can batch multiple updates into a single well-organized comment, but you MUST actually send it via \`gh issue comment\` for the user to see it.

**Always:**
- Communicate your progress via GitHub comments using \`gh issue comment\`
- Update the issue status labels to reflect your current state using \`gh issue edit\`
- Keep the human in the loop—post meaningful updates, not just status changes
${commentHistorySection}${profileSection}`.trim();
  }

  buildCommentPrompt(comment: ParsedComment): string {
    const authorName = comment.author?.name ?? "The user";

    return `
## New Comment from ${authorName}

${comment.body}

---

Respond based on the feedback type:
- **Approved** → Set status to Building, implement, then create PR and set to Review
- **Changes requested** → Update plan, stay in Feedback Needed
- **Question** → Answer it, stay in Feedback Needed

Use the labels and commands from your initial instructions.
`.trim();
  }

  buildRecoveryPrompt(
    issue: ParsedIssue,
    savedState: PersistedAgentState,
    profile?: AgentProfile
  ): string {
    const profileSection = this.buildProfileSection(profile);
    const repoArg = `${this.owner}/${this.repo}`;
    const issueNumber = issue.identifier.replace("#", "");

    return `
## Agent Recovery - Resuming Work on ${issue.identifier}

**IMPORTANT:** You are recovering from a crash and resuming work on this issue.

**Issue**: ${issue.identifier} - ${issue.title}
**Repository**: ${repoArg}
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

**Step 2:** Fetch the full issue history from GitHub (comments are your source of truth):
\`\`\`bash
gh issue view ${issueNumber} --repo ${repoArg} --comments
\`\`\`

**Step 3:** Post a recovery comment to GitHub:
\`\`\`bash
gh issue comment ${issueNumber} --repo ${repoArg} --body "**🤖 ${this.agentName}:** Recovering from a session restart. Reviewing the issue history and git state to resume work."
\`\`\`

**Step 4:** Based on the GitHub comments and git history, determine where you left off and continue.

### How to Communicate with GitHub

Use the \`gh\` CLI tool for all GitHub interactions.

**Post a comment:**
\`\`\`bash
gh issue comment ${issueNumber} --repo ${repoArg} --body "**🤖 ${this.agentName}:** Your message here"
\`\`\`

**Update status (via labels):**
\`\`\`bash
gh issue edit ${issueNumber} --repo ${repoArg} --remove-label "status:planning" --add-label "status:building"
\`\`\`

**Status Labels:**
| Status | Label |
|--------|-------|
| Planning | \`${STATUS_LABELS.planning}\` |
| Feedback Needed | \`${STATUS_LABELS.feedbackNeeded}\` |
| Building | \`${STATUS_LABELS.building}\` |
| Review | \`${STATUS_LABELS.review}\` |
| Done | Close the issue |

### Git Branch

You are working in branch \`issue/${issueNumber}\`. All commits go to this branch.

### Important - User Communication

**The user can ONLY see messages you send via GitHub comments.** Your internal thoughts, questions, and reasoning are invisible to them. If you need to ask questions, share findings, or report progress, you MUST post them as GitHub comments via \`gh issue comment\`.

- GitHub comments are your source of truth for what was planned and discussed
- Git history shows what code was actually written
- Always communicate your progress via GitHub comments
- Always update the issue status labels to reflect your current state
${profileSection}`.trim();
  }

  // ─────────────────────────────────────────────────────────────────
  // Environment
  // ─────────────────────────────────────────────────────────────────

  getAgentEnv(): Record<string, string> {
    return {
      GH_TOKEN: this.token,
      GITHUB_REPOSITORY: `${this.owner}/${this.repo}`,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  private buildWorkflowSection(issue: ParsedIssue, yolo: boolean): string {
    const repoArg = `${this.owner}/${this.repo}`;
    const issueNumber = issue.identifier.replace("#", "");

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
gh issue comment ${issueNumber} --repo ${repoArg} --body "**🤖 ${this.agentName}:** Here's my implementation plan:

[Your detailed plan here]

Proceeding to implementation (YOLO mode)."
\`\`\`

**Step 3:** Set status to Building and proceed to implement immediately:
\`\`\`bash
gh issue edit ${issueNumber} --repo ${repoArg} --remove-label "${STATUS_LABELS.planning}" --add-label "${STATUS_LABELS.building}"
\`\`\`

**Step 4:** Implement the plan - write code, tests, commit changes

**Step 5:** When done, push and create PR:
\`\`\`bash
git push -u origin issue/${issueNumber}
gh pr create --title "${issue.identifier}: ${issue.title}" --body "Resolves ${issue.identifier}" 2>/dev/null || echo "PR already exists, pushing updates"
\`\`\`

**Step 6:** Set status to Review:
\`\`\`bash
gh issue edit ${issueNumber} --repo ${repoArg} --remove-label "${STATUS_LABELS.building}" --add-label "${STATUS_LABELS.review}"
gh issue comment ${issueNumber} --repo ${repoArg} --body "**🤖 ${this.agentName}:** Implementation complete. PR created/updated and ready for review."
\`\`\`

**NOTE:** If you encounter a situation where you genuinely need user input, you may set status to Feedback Needed and wait.
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
gh issue comment ${issueNumber} --repo ${repoArg} --body "**🤖 ${this.agentName}:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Please review and let me know if you'd like any changes to this plan."
\`\`\`

**Step 3:** Set status to Feedback Needed and STOP:
\`\`\`bash
gh issue edit ${issueNumber} --repo ${repoArg} --remove-label "${STATUS_LABELS.planning}" --add-label "${STATUS_LABELS.feedbackNeeded}"
\`\`\`

**IMPORTANT:** After setting status to "Feedback Needed", STOP and wait for the user to respond. Do NOT proceed to building until the user provides feedback approving your plan.

### When Setting Status to Review

After the user approves and you complete implementation:
1. Push your changes and create a PR
2. Set status to Review
3. The user will receive a notification via GitHub

\`\`\`bash
gh issue edit ${issueNumber} --repo ${repoArg} --remove-label "${STATUS_LABELS.building}" --add-label "${STATUS_LABELS.review}"
\`\`\`
`;
  }

  private buildFileLinkingSection(issueIdentifier: string): string {
    const issueNumber = issueIdentifier.replace("#", "");
    const branch = `issue/${issueNumber}`;
    const baseUrl = `https://github.com/${this.owner}/${this.repo}`;

    return `
### File References in Comments

When referencing files in GitHub comments, use full GitHub URLs so they are clickable:
- Format: \`[filename](${baseUrl}/blob/${branch}/path/to/file)\`
- Example: \`[README.md](${baseUrl}/blob/${branch}/README.md)\`

This ensures file references link directly to the code on GitHub.
`;
  }

  private buildProfileSection(profile?: AgentProfile): string {
    if (!profile?.promptAdditions?.length) {
      return "";
    }

    return `

### Profile Capabilities

${profile.promptAdditions.join("\n\n")}
`;
  }

  private buildCommentHistorySection(comments?: FetchedComment[]): string {
    if (!comments || comments.length === 0) {
      return "";
    }

    const formattedComments = comments
      .map((c) => {
        const date = new Date(c.createdAt).toLocaleString();
        return `**${c.authorName}** (${date}):\n${c.body}`;
      })
      .join("\n\n---\n\n");

    return `

### Previous Discussion

This issue has existing comments from previous work. Review this history to understand what has been discussed and decided:

${formattedComments}

---

**Important:** If you see comments from a previous agent session (prefixed with 🤖), that agent may have crashed. Review what was planned or done and continue from where they left off rather than starting from scratch.
`;
  }
}

// Type definitions for GitHub webhook payloads
interface GitHubUserPayload {
  id: number;
  login: string;
}

interface GitHubLabelPayload {
  name: string;
  color?: string;
}

interface GitHubIssuePayload {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels?: (string | GitHubLabelPayload)[];
  assignee?: GitHubUserPayload | null;
  user?: GitHubUserPayload;
}

interface GitHubCommentPayload {
  id: number;
  body: string;
  user?: GitHubUserPayload;
  created_at: string;
}

interface GitHubWebhookPayload {
  action: string;
  issue?: GitHubIssuePayload;
  comment?: GitHubCommentPayload;
  repository?: {
    name: string;
    full_name: string;
    owner: GitHubUserPayload;
  };
}

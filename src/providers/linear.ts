// ABOUTME: Linear issue tracking provider implementation.
// ABOUTME: Handles Linear webhooks, issue operations, and prompt building.

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

// Linear state IDs (hardcoded for Ona workspace - could be made configurable)
const LINEAR_STATES: WorkflowStates = {
  planning: "260a76bf-dc1f-46ee-9c59-518c9558e7bb",
  feedbackNeeded: "38ab3462-5550-4dcf-a1dd-6845e3a1e963",
  building: "0aab3254-cc63-4979-84ab-eda800979c94",
  review: "e5708707-32a0-4ede-9f24-fb525d92b3d4",
  done: "edbec4af-dc30-4d27-a122-84395ac3b885",
};

const MAX_WEBHOOK_AGE_MS = 60000; // 60 seconds tolerance

/**
 * Linear issue tracking provider.
 */
export class LinearProvider implements IssueTrackingProvider {
  readonly type = "linear" as const;
  readonly realmName: string;
  readonly agentName: string;

  private readonly workspace: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly triggerStates: string[];
  private readonly botUserId?: string;

  constructor(config: ProviderConfig) {
    if (config.type !== "linear") {
      throw new Error(`LinearProvider requires type 'linear', got '${config.type}'`);
    }
    if (!config.linearWorkspace) {
      throw new Error("LinearProvider requires linearWorkspace");
    }
    if (!config.linearApiKey) {
      throw new Error("LinearProvider requires linearApiKey");
    }
    if (!config.linearWebhookSecret) {
      throw new Error("LinearProvider requires linearWebhookSecret");
    }

    this.realmName = config.realmName;
    this.agentName = config.agentName ?? "Amadeus";
    this.workspace = config.linearWorkspace;
    this.apiKey = config.linearApiKey;
    this.webhookSecret = config.linearWebhookSecret;
    this.triggerStates = config.triggerStates ?? ["Planning"];
    this.botUserId = config.botUserId;
  }

  // ─────────────────────────────────────────────────────────────────
  // Webhook handling
  // ─────────────────────────────────────────────────────────────────

  async verifyWebhook(payload: string, signature: string | null): Promise<boolean> {
    if (!signature || !this.webhookSecret) return false;

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
    const signatureBuffer = Buffer.from(signature, "hex");

    if (expectedBuffer.length !== signatureBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  parseWebhook(payload: string): ParsedWebhook {
    const data = JSON.parse(payload);
    const { action, type, data: webhookData } = data;

    if (type === "Issue" && !this.isComment(webhookData)) {
      return {
        type: "issue",
        action,
        issue: this.parseIssue(webhookData),
      };
    }

    if (type === "Comment" && this.isComment(webhookData)) {
      return {
        type: "comment",
        action,
        comment: this.parseComment(webhookData),
      };
    }

    return { type: "unknown", action };
  }

  validateTimestamp(payload: string): boolean {
    const data = JSON.parse(payload);
    const webhookTimestamp = data.webhookTimestamp;
    if (!webhookTimestamp) return false;

    const now = Date.now();
    return Math.abs(now - webhookTimestamp) <= MAX_WEBHOOK_AGE_MS;
  }

  private isComment(data: unknown): boolean {
    return (
      typeof data === "object" &&
      data !== null &&
      "body" in data &&
      "issueId" in data
    );
  }

  private parseIssue(data: LinearIssuePayload): ParsedIssue {
    return {
      id: data.id,
      identifier: data.identifier,
      title: data.title,
      description: data.description,
      priority: data.priority,
      state: data.state,
      assignee: data.assignee,
      labels: data.labels,
      teamKey: data.team?.key,
      projectName: data.project?.name,
      raw: data,
    };
  }

  private parseComment(data: LinearCommentPayload): ParsedComment {
    return {
      id: data.id,
      body: data.body,
      issueId: data.issueId,
      issue: this.parseIssue(data.issue),
      author: data.user ? { id: data.user.id, name: data.user.name } : undefined,
      createdAt: data.createdAt,
      raw: data,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Issue operations
  // ─────────────────────────────────────────────────────────────────

  getAgentKey(issue: ParsedIssue): string {
    const projectKey = issue.projectName ?? issue.teamKey ?? "DEFAULT";
    return `${projectKey}-${issue.id}`;
  }

  shouldStartAgent(issue: ParsedIssue): boolean {
    // Check if issue has the required agent label (case-insensitive)
    const agentNameLower = this.agentName.toLowerCase();
    const hasAgentLabel = issue.labels?.some(
      (l) => l.name.toLowerCase() === agentNameLower
    ) ?? false;

    if (!hasAgentLabel) {
      return false;
    }

    const stateMatch = this.triggerStates.includes(issue.state?.name ?? "");
    const assigneeMatch =
      this.botUserId !== undefined && issue.assignee?.id === this.botUserId;

    return stateMatch || assigneeMatch;
  }

  shouldTerminateAgent(issue: ParsedIssue): boolean {
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    const stateType = issue.state?.type?.toLowerCase() ?? "";

    return (
      stateType === "completed" ||
      stateType === "canceled" ||
      stateType === "backlog" ||
      stateName.includes("done") ||
      stateName.includes("backlog") ||
      stateName.includes("canceled") ||
      stateName.includes("cancelled") ||
      stateName.includes("todo")
    );
  }

  isAwaitingFeedback(issue: ParsedIssue): boolean {
    // Check if issue has the required agent label
    const agentNameLower = this.agentName.toLowerCase();
    const hasAgentLabel = issue.labels?.some(
      (l) => l.name.toLowerCase() === agentNameLower
    ) ?? false;

    if (!hasAgentLabel) {
      return false;
    }

    const stateName = issue.state?.name?.toLowerCase() ?? "";
    return stateName === "feedback needed";
  }

  isDraft(issue: ParsedIssue): boolean {
    const stateType = issue.state?.type?.toLowerCase();
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    return stateType === "triage" || stateName.includes("draft");
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

    return false;
  }

  getCompletionReason(issue: ParsedIssue): "done" | "stopped" | "canceled" | "backlog" {
    const stateName = issue.state?.name?.toLowerCase() ?? "";
    const stateType = issue.state?.type?.toLowerCase() ?? "";

    if (stateType === "completed" || stateName.includes("done")) {
      return "done";
    }
    if (stateType === "canceled" || stateName.includes("cancel")) {
      return "canceled";
    }
    if (stateType === "backlog" || stateName.includes("backlog") || stateName.includes("todo")) {
      return "backlog";
    }
    return "stopped";
  }

  // ─────────────────────────────────────────────────────────────────
  // State management
  // ─────────────────────────────────────────────────────────────────

  getWorkflowStates(): WorkflowStates {
    return LINEAR_STATES;
  }

  async updateIssueState(issueIdentifier: string, stateId: string): Promise<void> {
    const env = { ...process.env, LINEAR_API_KEY: this.apiKey };
    await $`linear-cli issues update ${issueIdentifier} --state ${stateId}`.env(env).quiet();
  }

  // ─────────────────────────────────────────────────────────────────
  // Comments
  // ─────────────────────────────────────────────────────────────────

  async fetchComments(issueId: string): Promise<FetchedComment[]> {
    const query = `
      query IssueComments($issueId: String!) {
        issue(id: $issueId) {
          comments {
            nodes {
              id
              body
              createdAt
              user {
                name
              }
            }
          }
        }
      }
    `;

    try {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({
          query,
          variables: { issueId },
        }),
      });

      if (!response.ok) {
        console.warn(`[Linear] Failed to fetch comments: ${response.status}`);
        return [];
      }

      const data = await response.json();
      const comments = data?.data?.issue?.comments?.nodes ?? [];

      return comments
        .sort(
          (a: { createdAt: string }, b: { createdAt: string }) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
        .map(
          (c: {
            id: string;
            body: string;
            createdAt: string;
            user?: { name: string };
          }) => ({
            id: c.id,
            body: c.body,
            authorName: c.user?.name ?? "Unknown",
            createdAt: c.createdAt,
          })
        );
    } catch (err) {
      console.warn("[Linear] Error fetching comments:", err);
      return [];
    }
  }

  async postComment(issueIdentifier: string, body: string): Promise<void> {
    const env = { ...process.env, LINEAR_API_KEY: this.apiKey };
    await $`linear-cli comments create --body ${body} ${issueIdentifier}`.env(env).quiet();
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
    const notificationSection = this.buildNotificationSection(issue.identifier);
    const workflowSection = this.buildWorkflowSection(issue, yolo, notificationSection);
    const fileLinkingSection = this.buildFileLinkingSection(githubRepoUrl, issue.identifier);
    const commentHistorySection = this.buildCommentHistorySection(existingComments);

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
linear-cli comments create --body "**🤖 ${this.agentName}:** Your message here" ${issue.identifier}
\`\`\`
**Important:** Always prefix your comments with \`**🤖 ${this.agentName}:**\` so users know it's from the AI agent.

**Update status:**
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "<state-id>"
\`\`\`

**State IDs:**
| Status | State ID |
|--------|----------|
| Planning | \`${LINEAR_STATES.planning}\` |
| Feedback Needed | \`${LINEAR_STATES.feedbackNeeded}\` |
| Building | \`${LINEAR_STATES.building}\` |
| Review | \`${LINEAR_STATES.review}\` |
| Done | \`${LINEAR_STATES.done}\` |

**Issue details:**
- Issue ID: ${issue.id}
- Issue identifier: ${issue.identifier}

These are also available as environment variables: LINEAR_ISSUE_ID and LINEAR_ISSUE_IDENTIFIER.

### Git Branch

You are working in branch \`issue/${issue.identifier}\`. All commits go to this branch.
${fileLinkingSection}${workflowSection}
### Important - User Communication

**The user can ONLY see messages you send via Linear comments.** Your internal thoughts, questions, and reasoning are invisible to them. If you need to:
- Ask a clarifying question → Post it as a Linear comment
- Share your analysis or findings → Post it as a Linear comment
- Request feedback or approval → Post it as a Linear comment
- Report progress or blockers → Post it as a Linear comment

Any thoughts or questions you don't post to Linear will never reach the user. You can batch multiple updates into a single well-organized comment, but you MUST actually send it via \`linear-cli comments create\` for the user to see it.

**Always:**
- Communicate your progress via Linear comments using \`linear-cli comments create\`
- Update the issue status to reflect your current state using \`linear-cli issues update\`
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

Use the state IDs and commands from your initial instructions.
`.trim();
  }

  buildRecoveryPrompt(
    issue: ParsedIssue,
    savedState: PersistedAgentState,
    profile?: AgentProfile
  ): string {
    const profileSection = this.buildProfileSection(profile);

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
linear-cli comments create --body "**🤖 ${this.agentName}:** Recovering from a session restart. Reviewing the issue history and git state to resume work." ${issue.identifier}
\`\`\`

**Step 4:** Based on the Linear comments and git history, determine where you left off and continue.

### How to Communicate with Linear

Use the \`linear-cli\` command line tool for all Linear interactions.

**Post a comment:**
\`\`\`bash
linear-cli comments create --body "**🤖 ${this.agentName}:** Your message here" ${issue.identifier}
\`\`\`

**Update status:**
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "<state-id>"
\`\`\`

**State IDs:**
| Status | State ID |
|--------|----------|
| Planning | \`${LINEAR_STATES.planning}\` |
| Feedback Needed | \`${LINEAR_STATES.feedbackNeeded}\` |
| Building | \`${LINEAR_STATES.building}\` |
| Review | \`${LINEAR_STATES.review}\` |
| Done | \`${LINEAR_STATES.done}\` |

### Git Branch

You are working in branch \`issue/${issue.identifier}\`. All commits go to this branch.

### Important - User Communication

**The user can ONLY see messages you send via Linear comments.** Your internal thoughts, questions, and reasoning are invisible to them. If you need to ask questions, share findings, or report progress, you MUST post them as Linear comments via \`linear-cli comments create\`.

- Linear comments are your source of truth for what was planned and discussed
- Git history shows what code was actually written
- Always communicate your progress via Linear comments
- Always update the issue status to reflect your current state
${profileSection}`.trim();
  }

  // ─────────────────────────────────────────────────────────────────
  // Environment
  // ─────────────────────────────────────────────────────────────────

  getAgentEnv(): Record<string, string> {
    return {
      LINEAR_API_KEY: this.apiKey,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  private buildWorkflowSection(
    issue: ParsedIssue,
    yolo: boolean,
    notificationSection: string
  ): string {
    const reviewNotificationSection = `
**Notify the issue creator:** After creating the PR, assign the issue to the creator:
\`\`\`bash
linear-cli issues get ${issue.identifier} -o json
\`\`\`
Find the creator's email and assign:
\`\`\`bash
linear-cli issues update ${issue.identifier} --assignee "<email>"
\`\`\`

This triggers an inbox notification that the PR is ready for review.
`;

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
linear-cli comments create --body "**🤖 ${this.agentName}:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Proceeding to implementation (YOLO mode)." ${issue.identifier}
\`\`\`

**Step 3:** Set status to Building and proceed to implement immediately:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "${LINEAR_STATES.building}"
\`\`\`

**Step 4:** Implement the plan - write code, tests, commit changes

**Step 5:** When done, push and create PR:
\`\`\`bash
git push -u origin issue/${issue.identifier}
gh pr create --title "${issue.identifier}: ${issue.title}" --body "Resolves ${issue.identifier}

Linear: https://linear.app/${this.workspace}/issue/${issue.identifier}" 2>/dev/null || echo "PR already exists, pushing updates"
\`\`\`

**Step 6:** Set status to Review:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "${LINEAR_STATES.review}"
linear-cli comments create --body "**🤖 ${this.agentName}:** Implementation complete. PR created/updated and ready for review." ${issue.identifier}
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
linear-cli comments create --body "**🤖 ${this.agentName}:** Here's my implementation plan:

[Your detailed plan here - include:
- What files will be modified/created
- The approach you'll take
- Any assumptions you're making
- Estimated scope of changes]

Please review and let me know if you'd like any changes to this plan." ${issue.identifier}
\`\`\`

**Step 3:** Set status to Feedback Needed and STOP:
\`\`\`bash
linear-cli issues update ${issue.identifier} --state "${LINEAR_STATES.feedbackNeeded}"
\`\`\`
${notificationSection}
**IMPORTANT:** After setting status to "Feedback Needed", STOP and wait for the user to respond. Do NOT proceed to building until the user provides feedback approving your plan.

### When Setting Status to Review

After the user approves and you complete implementation:
1. Push your changes and create a PR
2. Set status to Review
3. Notify the issue creator by assigning the issue to them (same process as above with \`--assignee\`)

This ensures they receive an inbox notification that the PR is ready for review.
`;
  }

  private buildFileLinkingSection(
    githubRepoUrl?: string,
    issueIdentifier?: string
  ): string {
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

  private buildNotificationSection(issueIdentifier: string): string {
    return `
**Notify the issue creator:** After posting your plan, assign the issue to the creator to trigger an inbox notification:

1. Get the issue creator's info:
\`\`\`bash
linear-cli issues get ${issueIdentifier} -o json
\`\`\`

2. Find the creator's email (e.g., \`mberg@ona.io\`)

3. Assign the issue to them:
\`\`\`bash
linear-cli issues update ${issueIdentifier} --assignee "<email>"
\`\`\`

This triggers a reliable inbox notification for the user.
`;
  }
}

// Type definitions for Linear webhook payloads
interface LinearIssuePayload {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority?: number;
  state?: { id: string; name: string; type?: string };
  assignee?: { id: string };
  labels?: { name: string }[];
  team?: { key: string };
  project?: { id: string; name: string };
  trashed?: boolean;
}

interface LinearCommentPayload {
  id: string;
  body: string;
  issueId: string;
  issue: LinearIssuePayload;
  user?: { id: string; name: string };
  createdAt: string;
}

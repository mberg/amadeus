// ABOUTME: GitHub integration for checking PR merge status and branch cleanup.
// ABOUTME: Uses gh CLI to detect when PRs are merged and delete branches.

import { $ } from "bun";

export interface PRStatus {
  merged: boolean;
  state: "OPEN" | "CLOSED" | "MERGED" | "NO_PR" | "ERROR";
  error?: string;
}

export type PRStatusExecutor = (
  issueIdentifier: string,
  projectPath: string
) => Promise<PRStatus>;

async function defaultExecutor(
  issueIdentifier: string,
  projectPath: string
): Promise<PRStatus> {
  const branchName = `issue/${issueIdentifier}`;

  try {
    const result =
      await $`gh pr view ${branchName} --json merged,state`.cwd(projectPath).quiet();
    const output = result.text();
    const data = JSON.parse(output);

    if (data.merged === true) {
      return { merged: true, state: "MERGED" };
    }

    return {
      merged: false,
      state: data.state === "OPEN" ? "OPEN" : "CLOSED",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (
      errorMessage.includes("no pull requests found") ||
      errorMessage.includes("Could not resolve")
    ) {
      return { merged: false, state: "NO_PR", error: errorMessage };
    }

    return { merged: false, state: "ERROR", error: errorMessage };
  }
}

export async function checkPRMerged(
  issueIdentifier: string,
  projectPath: string,
  executor: PRStatusExecutor = defaultExecutor
): Promise<PRStatus> {
  return executor(issueIdentifier, projectPath);
}

export interface DeleteBranchResult {
  success: boolean;
  localDeleted: boolean;
  remoteDeleted: boolean;
  error?: string;
}

/**
 * Deletes both local and remote branches for an issue.
 * Safe to call even if branches don't exist.
 */
export async function deleteBranch(
  issueIdentifier: string,
  projectPath: string
): Promise<DeleteBranchResult> {
  const branchName = `issue/${issueIdentifier}`;
  let localDeleted = false;
  let remoteDeleted = false;

  // Delete remote branch first
  try {
    const remoteResult = await $`git push origin --delete ${branchName}`
      .cwd(projectPath)
      .nothrow()
      .quiet();

    if (remoteResult.exitCode === 0) {
      remoteDeleted = true;
    } else {
      const stderr = remoteResult.stderr.toString();
      // Branch might not exist on remote, which is fine
      if (!stderr.includes("remote ref does not exist")) {
        console.warn(`[Branch] Failed to delete remote branch ${branchName}: ${stderr}`);
      }
    }
  } catch (err) {
    console.warn(`[Branch] Error deleting remote branch ${branchName}:`, err);
  }

  // Delete local branch
  try {
    const localResult = await $`git branch -D ${branchName}`
      .cwd(projectPath)
      .nothrow()
      .quiet();

    if (localResult.exitCode === 0) {
      localDeleted = true;
    } else {
      const stderr = localResult.stderr.toString();
      // Branch might not exist locally, which is fine
      if (!stderr.includes("not found")) {
        console.warn(`[Branch] Failed to delete local branch ${branchName}: ${stderr}`);
      }
    }
  } catch (err) {
    console.warn(`[Branch] Error deleting local branch ${branchName}:`, err);
  }

  return {
    success: localDeleted || remoteDeleted,
    localDeleted,
    remoteDeleted,
  };
}

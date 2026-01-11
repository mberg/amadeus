// ABOUTME: GitHub integration for checking PR merge status.
// ABOUTME: Uses gh CLI to detect when PRs are merged.

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

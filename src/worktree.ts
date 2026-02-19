// ABOUTME: Git worktree management for isolated issue development.
// ABOUTME: Creates and manages worktrees so each issue gets its own working directory.

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface CreateWorktreeOptions {
  repoPath: string;
  worktreesDir: string;
  issueIdentifier: string;
}

export interface CreateWorktreeResult {
  success: boolean;
  worktreePath?: string;
  branchName?: string;
  error?: string;
}

export interface RemoveWorktreeOptions {
  repoPath: string;
  worktreePath: string;
}

export interface RemoveWorktreeResult {
  success: boolean;
  error?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
}

/**
 * Generates the filesystem path for a worktree given the base directory and issue identifier.
 * Sanitizes the identifier to be filesystem-safe.
 */
export function getWorktreePath(
  worktreesDir: string,
  issueIdentifier: string
): string {
  const sanitized = issueIdentifier.replace(/[/\\]/g, "-");
  return join(worktreesDir, sanitized);
}

/**
 * Detects the default branch of a repository by checking for main, develop, master in order.
 * Falls back to the current HEAD branch if none are found.
 */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
  // Check origin/HEAD first (most reliable for cloned repos)
  const originHead = await Bun.$`cd ${repoPath} && git symbolic-ref refs/remotes/origin/HEAD`.nothrow().quiet();
  if (originHead.exitCode === 0) {
    const ref = originHead.stdout.toString().trim();
    const branch = ref.replace("refs/remotes/origin/", "");
    if (branch) return branch;
  }

  // Check for common branch names in priority order
  for (const candidate of ["main", "develop", "master"]) {
    const exists = await Bun.$`cd ${repoPath} && git show-ref --verify --quiet refs/heads/${candidate}`.nothrow();
    if (exists.exitCode === 0) return candidate;
  }

  // Fall back to current HEAD branch
  const head = await Bun.$`cd ${repoPath} && git rev-parse --abbrev-ref HEAD`.nothrow().quiet();
  return head.stdout.toString().trim() || "main";
}

/**
 * Creates a new git worktree for an issue.
 * Creates a branch named `issue/{identifier}` and checks it out in the worktree.
 */
export async function createWorktree(
  options: CreateWorktreeOptions
): Promise<CreateWorktreeResult> {
  const { repoPath, worktreesDir, issueIdentifier } = options;
  const worktreePath = getWorktreePath(worktreesDir, issueIdentifier);
  const branchName = `issue/${issueIdentifier}`;

  // Ensure worktrees directory exists
  await mkdir(worktreesDir, { recursive: true });

  // Check if worktree already exists - reuse it if so
  // Compare by sanitized identifier to handle path differences (e.g., /var vs /private/var on macOS)
  const worktrees = await listWorktrees(repoPath);
  const sanitizedIdentifier = issueIdentifier.replace(/[/\\]/g, "-");
  const existingWorktree = worktrees.find((w) => w.path.endsWith(`/${sanitizedIdentifier}`));
  if (existingWorktree) {
    console.log(`[Worktree] Reusing existing worktree at ${existingWorktree.path}`);
    return {
      success: true,
      worktreePath: existingWorktree.path,
      branchName: existingWorktree.branch?.replace("refs/heads/", "") ?? branchName,
    };
  }

  // Check if branch exists
  const branchExistsResult =
    await Bun.$`cd ${repoPath} && git show-ref --verify --quiet refs/heads/${branchName}`.nothrow();
  const branchExists = branchExistsResult.exitCode === 0;

  let result;
  if (branchExists) {
    // Use existing branch
    result = await Bun.$`cd ${repoPath} && git worktree add ${worktreePath} ${branchName}`.nothrow();
  } else {
    // Fetch the latest default branch from origin so the worktree starts from up-to-date code.
    // Fetches to the remote tracking ref (origin/branch) to avoid conflicts with the checked-out branch.
    // This is best-effort — silently continues if there's no remote or no network.
    const defaultBranch = await detectDefaultBranch(repoPath);
    const fetchResult = await Bun.$`cd ${repoPath} && git fetch origin ${defaultBranch}`.nothrow().quiet();
    const base = fetchResult.exitCode === 0 ? `origin/${defaultBranch}` : defaultBranch;
    if (fetchResult.exitCode !== 0) {
      console.log(`[Worktree] Could not fetch origin/${defaultBranch}, using local state`);
    }

    // Create new branch from the fetched remote ref (or local default branch as fallback)
    result = await Bun.$`cd ${repoPath} && git worktree add -b ${branchName} ${worktreePath} ${base}`.nothrow();
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString();
    // Check for common error patterns and provide clearer messages
    if (stderr.includes("already exists") || stderr.includes("already checked out")) {
      return {
        success: false,
        error: `Worktree or branch already exists: ${stderr.trim()}`,
      };
    }
    return {
      success: false,
      error: stderr.trim() || `Git worktree add failed with exit code ${result.exitCode}`,
    };
  }

  return {
    success: true,
    worktreePath,
    branchName,
  };
}

/**
 * Removes a git worktree.
 * Does not delete the branch, allowing changes to be reviewed and merged.
 */
export async function removeWorktree(
  options: RemoveWorktreeOptions
): Promise<RemoveWorktreeResult> {
  const { repoPath, worktreePath } = options;

  // Try to remove the worktree (--force in case of uncommitted changes)
  const result =
    await Bun.$`cd ${repoPath} && git worktree remove --force ${worktreePath}`.nothrow();

  if (result.exitCode !== 0) {
    // Worktree might not exist, which is fine (idempotent)
    const stderr = result.stderr.toString();
    if (!stderr.includes("is not a working tree")) {
      return { success: false, error: stderr };
    }
  }

  return { success: true };
}

/**
 * Lists all worktrees for a repository.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const result =
    await Bun.$`cd ${repoPath} && git worktree list --porcelain`.nothrow();

  if (result.exitCode !== 0) {
    return [];
  }

  const output = result.stdout.toString();
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = { path: line.substring(9) };
    } else if (line.startsWith("HEAD ")) {
      current.commit = line.substring(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.substring(7);
    } else if (line === "bare" || line === "detached") {
      current.branch = line;
    }
  }

  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }

  return worktrees;
}

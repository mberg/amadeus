// ABOUTME: Git utility functions for extracting repository information.
// ABOUTME: Parses GitHub URLs from git remote formats.

/**
 * Parse a git remote URL and extract the GitHub repo URL.
 * Supports both SSH (git@github.com:owner/repo.git) and HTTPS formats.
 * Returns null if not a GitHub URL or invalid format.
 */
export function parseGitHubUrl(remoteUrl: string): string | null {
  if (!remoteUrl) return null;

  // SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return `https://github.com/${owner}/${repo}`;
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch;
    return `https://github.com/${owner}/${repo}`;
  }

  return null;
}

/**
 * Get the GitHub repo URL for a git repository directory.
 * Runs `git remote get-url origin` and parses the result.
 * Returns null if not a git repo or not hosted on GitHub.
 */
export async function getGitHubRepoUrl(repoPath: string): Promise<string | null> {
  try {
    const result = await Bun.$`git -C ${repoPath} remote get-url origin`.quiet();
    const remoteUrl = result.stdout.toString().trim();
    return parseGitHubUrl(remoteUrl);
  } catch {
    return null;
  }
}

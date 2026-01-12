// ABOUTME: Tests for git utility functions.
// ABOUTME: Validates GitHub URL parsing from git remote formats.

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { parseGitHubUrl, getGitHubRepoUrl } from "../src/git-utils";

describe("parseGitHubUrl", () => {
  test("parses SSH format git@github.com:owner/repo.git", () => {
    const result = parseGitHubUrl("git@github.com:mberg/amadeus.git");
    expect(result).toBe("https://github.com/mberg/amadeus");
  });

  test("parses SSH format without .git suffix", () => {
    const result = parseGitHubUrl("git@github.com:mberg/amadeus");
    expect(result).toBe("https://github.com/mberg/amadeus");
  });

  test("parses HTTPS format with .git suffix", () => {
    const result = parseGitHubUrl("https://github.com/mberg/amadeus.git");
    expect(result).toBe("https://github.com/mberg/amadeus");
  });

  test("parses HTTPS format without .git suffix", () => {
    const result = parseGitHubUrl("https://github.com/mberg/amadeus");
    expect(result).toBe("https://github.com/mberg/amadeus");
  });

  test("handles repos with hyphens and underscores", () => {
    const result = parseGitHubUrl("git@github.com:some-org/my_project-name.git");
    expect(result).toBe("https://github.com/some-org/my_project-name");
  });

  test("returns null for non-GitHub URLs", () => {
    expect(parseGitHubUrl("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(parseGitHubUrl("https://gitlab.com/owner/repo.git")).toBeNull();
    expect(parseGitHubUrl("git@bitbucket.org:owner/repo.git")).toBeNull();
  });

  test("returns null for invalid URLs", () => {
    expect(parseGitHubUrl("")).toBeNull();
    expect(parseGitHubUrl("not-a-url")).toBeNull();
    expect(parseGitHubUrl("github.com/owner/repo")).toBeNull();
  });
});

describe("getGitHubRepoUrl", () => {
  test("returns GitHub URL for valid git directory", async () => {
    // Use the current repo as test case
    const result = await getGitHubRepoUrl(process.cwd());
    expect(result).toBe("https://github.com/mberg/amadeus");
  });

  test("returns null for non-git directory", async () => {
    const result = await getGitHubRepoUrl("/tmp");
    expect(result).toBeNull();
  });
});

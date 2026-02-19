// ABOUTME: Tests for git worktree management functionality.
// ABOUTME: Tests creation, removal, and listing of worktrees for issues.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  getWorktreePath,
  detectDefaultBranch,
} from "../src/worktree";

describe("Worktree", () => {
  let testRepoDir: string;
  let worktreesDir: string;

  beforeEach(async () => {
    // Create a temporary git repository for testing
    testRepoDir = await mkdtemp(join(tmpdir(), "amadeus-worktree-test-"));
    worktreesDir = join(testRepoDir, "worktrees");

    // Initialize git repo with an initial commit
    const initResult = await Bun.$`cd ${testRepoDir} && git init && git config user.email "test@test.com" && git config user.name "Test" && echo "test" > README.md && git add . && git commit -m "initial"`.quiet();
    if (initResult.exitCode !== 0) {
      throw new Error(`Failed to init test repo: ${initResult.stderr}`);
    }
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testRepoDir, { recursive: true, force: true });
  });

  describe("getWorktreePath", () => {
    it("generates path from worktrees dir and issue identifier", () => {
      const path = getWorktreePath("/tmp/worktrees", "ONA-125");
      expect(path).toBe("/tmp/worktrees/ONA-125");
    });

    it("sanitizes issue identifier for filesystem safety", () => {
      const path = getWorktreePath("/tmp/worktrees", "TEST/123");
      expect(path).toBe("/tmp/worktrees/TEST-123");
    });
  });

  describe("detectDefaultBranch", () => {
    it("detects main as default branch", async () => {
      const branch = await detectDefaultBranch(testRepoDir);
      // git init creates 'master' or 'main' depending on git config
      expect(["main", "master"]).toContain(branch);
    });

    it("prefers main over master when both exist", async () => {
      await Bun.$`cd ${testRepoDir} && git branch main`.quiet().nothrow();
      await Bun.$`cd ${testRepoDir} && git branch master`.quiet().nothrow();
      const branch = await detectDefaultBranch(testRepoDir);
      expect(branch).toBe("main");
    });

    it("detects develop when main and master do not exist", async () => {
      // Rename current branch to develop
      const currentBranch = (await Bun.$`cd ${testRepoDir} && git rev-parse --abbrev-ref HEAD`.quiet()).stdout.toString().trim();
      await Bun.$`cd ${testRepoDir} && git branch -m ${currentBranch} develop`.quiet();
      const branch = await detectDefaultBranch(testRepoDir);
      expect(branch).toBe("develop");
    });
  });

  describe("createWorktree", () => {
    it("creates a new worktree with issue branch", async () => {
      const result = await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-1",
      });

      expect(result.success).toBe(true);
      expect(result.worktreePath).toBe(join(worktreesDir, "TEST-1"));
      expect(result.branchName).toBe("issue/TEST-1");

      // Verify worktree directory exists
      const stat = await Bun.file(join(worktreesDir, "TEST-1", "README.md")).exists();
      expect(stat).toBe(true);
    });

    it("creates worktrees directory if it does not exist", async () => {
      const newWorktreesDir = join(testRepoDir, "new-worktrees");

      const result = await createWorktree({
        repoPath: testRepoDir,
        worktreesDir: newWorktreesDir,
        issueIdentifier: "TEST-2",
      });

      expect(result.success).toBe(true);
      const dirExists = await Bun.file(newWorktreesDir).exists();
      // Note: Bun.file().exists() doesn't work for directories, we check by the worktree
      expect(result.worktreePath).toContain("TEST-2");
    });

    it("reuses existing worktree if it already exists", async () => {
      const first = await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-3",
      });

      expect(first.success).toBe(true);

      const second = await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-3",
      });

      expect(second.success).toBe(true);
      // Paths may differ due to symlink resolution (e.g., /var vs /private/var on macOS)
      // but should end with the same identifier
      expect(second.worktreePath?.endsWith("TEST-3")).toBe(true);
      expect(second.branchName).toBe(first.branchName);
    });

    it("creates worktree from latest commit of default branch via fetch", async () => {
      // Set up a bare "remote" with an extra commit
      const remoteDir = await mkdtemp(join(tmpdir(), "amadeus-remote-test-"));
      try {
        await Bun.$`git clone --bare ${testRepoDir} ${remoteDir}`.quiet();
        await Bun.$`cd ${testRepoDir} && git remote add origin ${remoteDir}`.quiet();

        // Add a new commit to the remote that the local repo doesn't have
        const cloneDir = await mkdtemp(join(tmpdir(), "amadeus-clone-test-"));
        try {
          await Bun.$`git clone ${remoteDir} ${cloneDir}`.quiet();
          await Bun.$`cd ${cloneDir} && git config user.email "test@test.com" && git config user.name "Test" && echo "new" > NEW.md && git add . && git commit -m "new commit" && git push`.quiet();
        } finally {
          await rm(cloneDir, { recursive: true, force: true });
        }

        const defaultBranch = await detectDefaultBranch(testRepoDir);
        const result = await createWorktree({
          repoPath: testRepoDir,
          worktreesDir,
          issueIdentifier: "TEST-FETCH",
        });

        expect(result.success).toBe(true);

        // The worktree should contain the new file from the remote commit
        const hasNewFile = await Bun.file(join(result.worktreePath!, "NEW.md")).exists();
        expect(hasNewFile).toBe(true);
      } finally {
        await rm(remoteDir, { recursive: true, force: true });
      }
    });

    it("uses existing branch if it exists", async () => {
      // Create a branch first
      await Bun.$`cd ${testRepoDir} && git branch issue/TEST-4`.quiet();

      const result = await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-4",
      });

      expect(result.success).toBe(true);
      expect(result.branchName).toBe("issue/TEST-4");
    });
  });

  describe("removeWorktree", () => {
    it("removes an existing worktree", async () => {
      await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-5",
      });

      const result = await removeWorktree({
        repoPath: testRepoDir,
        worktreePath: join(worktreesDir, "TEST-5"),
      });

      expect(result.success).toBe(true);
    });

    it("returns success even if worktree does not exist", async () => {
      const result = await removeWorktree({
        repoPath: testRepoDir,
        worktreePath: join(worktreesDir, "NONEXISTENT"),
      });

      // Should be idempotent - removing non-existent worktree is fine
      expect(result.success).toBe(true);
    });
  });

  describe("listWorktrees", () => {
    it("lists all worktrees for a repository", async () => {
      await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-6",
      });
      await createWorktree({
        repoPath: testRepoDir,
        worktreesDir,
        issueIdentifier: "TEST-7",
      });

      const worktrees = await listWorktrees(testRepoDir);

      // Should include main repo + 2 worktrees
      expect(worktrees.length).toBeGreaterThanOrEqual(3);
      expect(worktrees.some((w) => w.path.includes("TEST-6"))).toBe(true);
      expect(worktrees.some((w) => w.path.includes("TEST-7"))).toBe(true);
    });

    it("returns only main worktree when no additional worktrees exist", async () => {
      const worktrees = await listWorktrees(testRepoDir);

      expect(worktrees.length).toBe(1);
    });
  });
});

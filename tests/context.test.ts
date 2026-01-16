// ABOUTME: Tests for the .context directory knowledge management module.
// ABOUTME: Validates saving, searching, and retrieving cross-agent knowledge.

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ensureContextDir,
  saveKnowledge,
  saveIssueSummary,
  saveDebugArtifact,
  searchContext,
  getContextSummary,
  type KnowledgeEntry,
  type IssueSummary,
  type DebugArtifact,
} from "../src/context";

const TEST_DIR = "/tmp/amadeus-context-tests";
const PROJECT_DIR = join(TEST_DIR, "test-project");
const CONTEXT_DIR = join(PROJECT_DIR, ".context");

describe("Context Directory Management", () => {
  beforeEach(async () => {
    await mkdir(PROJECT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("creates .context directory structure if it doesn't exist", async () => {
    await ensureContextDir(PROJECT_DIR);

    const dirs = await readdir(CONTEXT_DIR);
    expect(dirs).toContain("knowledge");
    expect(dirs).toContain("issues");
    expect(dirs).toContain("debug");
  });

  test("does nothing if .context already exists", async () => {
    await mkdir(join(CONTEXT_DIR, "knowledge"), { recursive: true });
    await Bun.write(join(CONTEXT_DIR, "knowledge", "existing.md"), "# Existing");

    await ensureContextDir(PROJECT_DIR);

    const content = await readFile(join(CONTEXT_DIR, "knowledge", "existing.md"), "utf-8");
    expect(content).toBe("# Existing");
  });
});

describe("Knowledge Management", () => {
  beforeEach(async () => {
    await mkdir(PROJECT_DIR, { recursive: true });
    await ensureContextDir(PROJECT_DIR);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("saves a knowledge entry as markdown", async () => {
    const entry: KnowledgeEntry = {
      title: "Auth System Architecture",
      content: "The auth system uses JWT tokens stored in Redis...",
      tags: ["auth", "jwt", "redis"],
      sourceIssue: "ONA-1234",
    };

    const filePath = await saveKnowledge(PROJECT_DIR, entry);

    expect(filePath).toContain(".context/knowledge/");
    expect(filePath).toEndWith(".md");

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Auth System Architecture");
    expect(content).toContain("The auth system uses JWT tokens stored in Redis...");
    expect(content).toContain("tags: auth, jwt, redis");
    expect(content).toContain("source: ONA-1234");
  });

  test("generates slug-based filename from title", async () => {
    const entry: KnowledgeEntry = {
      title: "How API Rate Limiting Works",
      content: "Rate limiting is implemented via...",
      tags: ["api", "rate-limiting"],
    };

    const filePath = await saveKnowledge(PROJECT_DIR, entry);

    expect(filePath).toContain("how-api-rate-limiting-works.md");
  });

  test("handles duplicate titles by appending timestamp", async () => {
    const entry: KnowledgeEntry = {
      title: "Database Patterns",
      content: "First entry",
      tags: ["db"],
    };

    const filePath1 = await saveKnowledge(PROJECT_DIR, entry);
    const filePath2 = await saveKnowledge(PROJECT_DIR, {
      ...entry,
      content: "Second entry",
    });

    expect(filePath1).not.toBe(filePath2);

    const content1 = await readFile(filePath1, "utf-8");
    const content2 = await readFile(filePath2, "utf-8");
    expect(content1).toContain("First entry");
    expect(content2).toContain("Second entry");
  });
});

describe("Issue Summary Management", () => {
  beforeEach(async () => {
    await mkdir(PROJECT_DIR, { recursive: true });
    await ensureContextDir(PROJECT_DIR);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("saves an issue summary", async () => {
    const summary: IssueSummary = {
      identifier: "ONA-1234",
      title: "Fix authentication bug",
      outcome: "Fixed JWT token expiry handling in auth middleware",
      keyLearnings: [
        "Token refresh must happen before expiry, not after",
        "Redis connection pooling was causing stale tokens",
      ],
      filesModified: ["src/auth/jwt.ts", "src/middleware/auth.ts"],
      relatedIssues: ["ONA-1200", "ONA-1210"],
    };

    const filePath = await saveIssueSummary(PROJECT_DIR, summary);

    expect(filePath).toBe(join(CONTEXT_DIR, "issues", "ONA-1234.md"));

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# ONA-1234: Fix authentication bug");
    expect(content).toContain("## Outcome");
    expect(content).toContain("Fixed JWT token expiry handling");
    expect(content).toContain("## Key Learnings");
    expect(content).toContain("Token refresh must happen before expiry");
    expect(content).toContain("## Files Modified");
    expect(content).toContain("src/auth/jwt.ts");
    expect(content).toContain("## Related Issues");
    expect(content).toContain("ONA-1200");
  });

  test("overwrites existing issue summary", async () => {
    const summary1: IssueSummary = {
      identifier: "ONA-5678",
      title: "Initial title",
      outcome: "First outcome",
      keyLearnings: [],
      filesModified: [],
    };

    const summary2: IssueSummary = {
      identifier: "ONA-5678",
      title: "Updated title",
      outcome: "Updated outcome",
      keyLearnings: ["New learning"],
      filesModified: ["new-file.ts"],
    };

    await saveIssueSummary(PROJECT_DIR, summary1);
    await saveIssueSummary(PROJECT_DIR, summary2);

    const content = await readFile(join(CONTEXT_DIR, "issues", "ONA-5678.md"), "utf-8");
    expect(content).toContain("Updated title");
    expect(content).toContain("Updated outcome");
    expect(content).not.toContain("First outcome");
  });
});

describe("Debug Artifact Management", () => {
  beforeEach(async () => {
    await mkdir(PROJECT_DIR, { recursive: true });
    await ensureContextDir(PROJECT_DIR);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("saves a debug artifact", async () => {
    const artifact: DebugArtifact = {
      title: "WebSocket Connection Race Condition",
      symptom: "Intermittent connection failures on page load",
      rootCause: "WebSocket init was racing with auth token fetch",
      solution: "Added await for token before WebSocket connect",
      sourceIssue: "ONA-2000",
    };

    const filePath = await saveDebugArtifact(PROJECT_DIR, artifact);

    expect(filePath).toContain(".context/debug/");
    expect(filePath).toEndWith(".md");

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# WebSocket Connection Race Condition");
    expect(content).toContain("## Symptom");
    expect(content).toContain("Intermittent connection failures");
    expect(content).toContain("## Root Cause");
    expect(content).toContain("racing with auth token fetch");
    expect(content).toContain("## Solution");
    expect(content).toContain("Added await for token");
  });
});

describe("Context Search", () => {
  beforeEach(async () => {
    await mkdir(PROJECT_DIR, { recursive: true });
    await ensureContextDir(PROJECT_DIR);

    // Set up test data
    await saveKnowledge(PROJECT_DIR, {
      title: "Auth System Overview",
      content: "The authentication system uses JWT tokens with Redis for session storage.",
      tags: ["auth", "jwt", "redis"],
      sourceIssue: "ONA-100",
    });

    await saveKnowledge(PROJECT_DIR, {
      title: "API Rate Limiting",
      content: "Rate limiting is implemented using a sliding window algorithm.",
      tags: ["api", "rate-limiting"],
      sourceIssue: "ONA-200",
    });

    await saveIssueSummary(PROJECT_DIR, {
      identifier: "ONA-300",
      title: "Fix Redis connection pooling",
      outcome: "Increased pool size and added connection health checks",
      keyLearnings: ["Redis connections can go stale in long-running processes"],
      filesModified: ["src/redis.ts"],
    });

    await saveDebugArtifact(PROJECT_DIR, {
      title: "JWT Token Expiry Bug",
      symptom: "Users logged out unexpectedly",
      rootCause: "Token refresh not triggered before expiry",
      solution: "Added proactive refresh 5 minutes before expiry",
      sourceIssue: "ONA-400",
    });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("searches knowledge by keyword", async () => {
    const results = await searchContext(PROJECT_DIR, "JWT");

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title.includes("Auth"))).toBe(true);
  });

  test("searches across all context types", async () => {
    const results = await searchContext(PROJECT_DIR, "Redis");

    // Should find: knowledge article about auth (mentions Redis),
    // and issue summary about Redis connection pooling
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("returns empty array when no matches", async () => {
    const results = await searchContext(PROJECT_DIR, "nonexistent-term-xyz");

    expect(results).toEqual([]);
  });

  test("searches by tag", async () => {
    const results = await searchContext(PROJECT_DIR, "rate-limiting");

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title.includes("Rate Limiting"))).toBe(true);
  });

  test("limits results", async () => {
    const results = await searchContext(PROJECT_DIR, "auth", { limit: 1 });

    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe("Context Summary", () => {
  beforeEach(async () => {
    await mkdir(PROJECT_DIR, { recursive: true });
    await ensureContextDir(PROJECT_DIR);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("returns summary of available context", async () => {
    await saveKnowledge(PROJECT_DIR, {
      title: "Architecture Overview",
      content: "System architecture description...",
      tags: ["architecture"],
    });

    await saveKnowledge(PROJECT_DIR, {
      title: "API Patterns",
      content: "API design patterns...",
      tags: ["api"],
    });

    await saveIssueSummary(PROJECT_DIR, {
      identifier: "ONA-100",
      title: "Initial setup",
      outcome: "Project initialized",
      keyLearnings: [],
      filesModified: [],
    });

    const summary = await getContextSummary(PROJECT_DIR);

    expect(summary.knowledgeCount).toBe(2);
    expect(summary.issueCount).toBe(1);
    expect(summary.debugCount).toBe(0);
    expect(summary.knowledgeTitles).toContain("Architecture Overview");
    expect(summary.knowledgeTitles).toContain("API Patterns");
    expect(summary.issueSummaries).toContain("ONA-100");
  });

  test("returns empty summary for empty context", async () => {
    const summary = await getContextSummary(PROJECT_DIR);

    expect(summary.knowledgeCount).toBe(0);
    expect(summary.issueCount).toBe(0);
    expect(summary.debugCount).toBe(0);
    expect(summary.knowledgeTitles).toEqual([]);
    expect(summary.issueSummaries).toEqual([]);
  });

  test("returns empty summary when .context doesn't exist", async () => {
    const nonExistentProject = join(TEST_DIR, "no-context-project");
    await mkdir(nonExistentProject, { recursive: true });

    const summary = await getContextSummary(nonExistentProject);

    expect(summary.knowledgeCount).toBe(0);
    expect(summary.issueCount).toBe(0);
    expect(summary.debugCount).toBe(0);
  });
});

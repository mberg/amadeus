// ABOUTME: Tests for agent profile loading and resolution.
// ABOUTME: Validates profile inheritance, merging, and label-based selection.

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProfiles, resolveProfile, mergeProfiles, resolveSkillLabels } from "../src/profiles";
import type { AgentProfile, LinearIssue } from "../src/types";

const TEST_DIR = "/tmp/amadeus-profile-tests";
const PROFILES_DIR = join(TEST_DIR, "agent-profiles");

async function writeProfile(name: string, profile: AgentProfile): Promise<void> {
  await writeFile(
    join(PROFILES_DIR, `${name}.json`),
    JSON.stringify(profile, null, 2)
  );
}

describe("Profile Loading", () => {
  beforeEach(async () => {
    await mkdir(PROFILES_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("loads a simple profile", async () => {
    const profile: AgentProfile = {
      mcpServers: {
        linear: {
          command: "npx",
          args: ["-y", "@linear/mcp-server"],
        },
      },
      promptAdditions: ["You have access to Linear."],
    };
    await writeProfile("base", profile);

    const profiles = await loadProfiles(PROFILES_DIR);
    expect(profiles.base).toBeDefined();
    expect(profiles.base.mcpServers?.linear).toBeDefined();
    expect(profiles.base.promptAdditions).toContain("You have access to Linear.");
  });

  test("loads multiple profiles", async () => {
    await writeProfile("base", { promptAdditions: ["Base instructions"] });
    await writeProfile("frontend", {
      extends: "base",
      promptAdditions: ["Frontend instructions"],
    });

    const profiles = await loadProfiles(PROFILES_DIR);
    expect(Object.keys(profiles)).toHaveLength(2);
    expect(profiles.base).toBeDefined();
    expect(profiles.frontend).toBeDefined();
  });

  test("returns empty object when directory doesn't exist", async () => {
    const profiles = await loadProfiles("/nonexistent/path");
    expect(profiles).toEqual({});
  });
});

describe("Profile Resolution", () => {
  let profiles: Record<string, AgentProfile>;

  beforeEach(async () => {
    await mkdir(PROFILES_DIR, { recursive: true });

    await writeProfile("base", {
      mcpServers: {
        linear: { command: "npx", args: ["-y", "@linear/mcp"] },
      },
      permissions: { allow: ["Bash(linear-cli:*)"] },
      promptAdditions: ["Base prompt"],
    });

    await writeProfile("frontend", {
      extends: "base",
      mcpServers: {
        playwright: { command: "npx", args: ["-y", "@anthropic/mcp-playwright"] },
      },
      permissions: { allow: ["Bash(playwright:*)"] },
      skills: { install: ["frontend-design@anthropic-agent-skills"] },
      promptAdditions: ["Frontend prompt"],
    });

    await writeProfile("backend", {
      extends: "base",
      mcpServers: {
        database: { command: "npx", args: ["-y", "@sqlite/mcp"] },
      },
      promptAdditions: ["Backend prompt"],
    });

    profiles = await loadProfiles(PROFILES_DIR);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("resolves profile from label", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "profile:frontend" }],
    };

    const profileName = resolveProfile(issue, profiles, "base");
    expect(profileName).toBe("frontend");
  });

  test("falls back to default when no label match", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "bug" }],
    };

    const profileName = resolveProfile(issue, profiles, "base");
    expect(profileName).toBe("base");
  });

  test("resolves multiple profiles from labels", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "profile:frontend" }, { name: "profile:backend" }],
    };

    const profileNames = resolveProfile(issue, profiles, "base");
    expect(profileNames).toEqual(["frontend", "backend"]);
  });

  test("handles missing profile gracefully", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "profile:nonexistent" }],
    };

    const profileName = resolveProfile(issue, profiles, "base");
    expect(profileName).toBe("base");
  });
});

describe("Profile Merging", () => {
  test("merges child profile with parent", () => {
    const base: AgentProfile = {
      mcpServers: {
        linear: { command: "npx", args: ["-y", "@linear/mcp"] },
      },
      permissions: { allow: ["Bash(linear-cli:*)"] },
      promptAdditions: ["Base prompt"],
    };

    const frontend: AgentProfile = {
      extends: "base",
      mcpServers: {
        playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
      },
      permissions: { allow: ["Bash(playwright:*)"] },
      promptAdditions: ["Frontend prompt"],
    };

    const merged = mergeProfiles(base, frontend);

    // Should have both MCP servers
    expect(merged.mcpServers?.linear).toBeDefined();
    expect(merged.mcpServers?.playwright).toBeDefined();

    // Should merge permissions
    expect(merged.permissions?.allow).toContain("Bash(linear-cli:*)");
    expect(merged.permissions?.allow).toContain("Bash(playwright:*)");

    // Should merge prompt additions
    expect(merged.promptAdditions).toContain("Base prompt");
    expect(merged.promptAdditions).toContain("Frontend prompt");
  });

  test("child overrides parent MCP server config", () => {
    const base: AgentProfile = {
      mcpServers: {
        linear: { command: "npx", args: ["old-version"] },
      },
    };

    const child: AgentProfile = {
      mcpServers: {
        linear: { command: "npx", args: ["new-version"] },
      },
    };

    const merged = mergeProfiles(base, child);
    expect(merged.mcpServers?.linear?.args).toEqual(["new-version"]);
  });

  test("merges multiple profiles in order", () => {
    const profiles: Record<string, AgentProfile> = {
      base: { promptAdditions: ["Base"] },
      frontend: { promptAdditions: ["Frontend"] },
      backend: { promptAdditions: ["Backend"] },
    };

    const merged = mergeProfiles(
      profiles.base,
      mergeProfiles(profiles.frontend, profiles.backend)
    );

    expect(merged.promptAdditions).toContain("Base");
    expect(merged.promptAdditions).toContain("Frontend");
    expect(merged.promptAdditions).toContain("Backend");
  });

  test("merges skills arrays", () => {
    const base: AgentProfile = {
      skills: {
        marketplaces: ["anthropics/skills"],
        install: ["base-skill"],
      },
    };

    const child: AgentProfile = {
      skills: {
        install: ["frontend-design"],
        local: ["custom-skill"],
      },
    };

    const merged = mergeProfiles(base, child);
    expect(merged.skills?.marketplaces).toContain("anthropics/skills");
    expect(merged.skills?.install).toContain("base-skill");
    expect(merged.skills?.install).toContain("frontend-design");
    expect(merged.skills?.local).toContain("custom-skill");
  });
});

describe("Skill Label Resolution", () => {
  let skillProfiles: Record<string, AgentProfile>;

  beforeEach(async () => {
    await mkdir(PROFILES_DIR, { recursive: true });

    await writeProfile("frontend-design", {
      skills: {
        marketplaces: ["anthropics/skills"],
        install: ["frontend-design@anthropic-agent-skills"],
      },
      promptAdditions: ["You have the frontend-design skill enabled."],
    });

    await writeProfile("code-review", {
      skills: {
        install: ["code-review@anthropic-agent-skills"],
      },
      promptAdditions: ["You have the code-review skill enabled."],
    });

    await writeProfile("superpowers", {
      skills: {
        marketplaces: ["obra/superpowers-marketplace"],
        install: ["superpowers@superpowers-marketplace"],
      },
      promptAdditions: ["You have the superpowers skill enabled."],
    });

    skillProfiles = await loadProfiles(PROFILES_DIR);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("resolves single skill from label", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "frontend-design" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual(["frontend-design"]);
  });

  test("resolves multiple skills from labels", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "frontend-design" }, { name: "code-review" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toContain("frontend-design");
    expect(skills).toContain("code-review");
    expect(skills).toHaveLength(2);
  });

  test("ignores labels that don't match skill profiles", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "frontend-design" }, { name: "bug" }, { name: "amadeus" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual(["frontend-design"]);
  });

  test("returns empty array when no skill labels match", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "bug" }, { name: "amadeus" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual([]);
  });

  test("handles issue with no labels", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual([]);
  });

  test("skill label matching is case-insensitive", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "Frontend-Design" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual(["frontend-design"]);
  });

  test("ignores profile: prefixed labels", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "profile:frontend-design" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual([]);
  });

  test("resolves superpowers skill from label", () => {
    const issue: LinearIssue = {
      id: "123",
      identifier: "TEST-1",
      title: "Test issue",
      labels: [{ name: "superpowers" }],
    };

    const skills = resolveSkillLabels(issue, skillProfiles);
    expect(skills).toEqual(["superpowers"]);
  });
});

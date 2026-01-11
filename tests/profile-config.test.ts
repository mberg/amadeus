// ABOUTME: Tests for profile configuration writer.
// ABOUTME: Validates MCP, permissions, and skill config file generation.

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { applyProfileConfig } from "../src/profile-config";
import type { AgentProfile } from "../src/types";

const TEST_DIR = "/tmp/amadeus-profile-config-tests";
const SKILLS_SOURCE_DIR = join(TEST_DIR, "skill-source");

describe("Profile Config Application", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(SKILLS_SOURCE_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("writes MCP server configuration to .mcp.json", async () => {
    const profile: AgentProfile = {
      mcpServers: {
        linear: {
          command: "npx",
          args: ["-y", "@linear/mcp-server"],
          env: { LINEAR_API_KEY: "${LINEAR_API_KEY}" },
        },
      },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toContain(join(TEST_DIR, ".mcp.json"));

    const mcpConfig = JSON.parse(await readFile(join(TEST_DIR, ".mcp.json"), "utf-8"));
    expect(mcpConfig.mcpServers.linear).toBeDefined();
    expect(mcpConfig.mcpServers.linear.type).toBe("stdio");
    expect(mcpConfig.mcpServers.linear.command).toBe("npx");
    expect(mcpConfig.mcpServers.linear.args).toEqual(["-y", "@linear/mcp-server"]);
    expect(mcpConfig.mcpServers.linear.env.LINEAR_API_KEY).toBe("${LINEAR_API_KEY}");
  });

  test("writes permissions to .claude/settings.json", async () => {
    const profile: AgentProfile = {
      permissions: {
        allow: ["Bash(npm:*)", "Bash(git:*)"],
        deny: ["Bash(rm -rf:*)"],
      },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toContain(join(TEST_DIR, ".claude", "settings.json"));

    const settings = JSON.parse(
      await readFile(join(TEST_DIR, ".claude", "settings.json"), "utf-8")
    );
    expect(settings.permissions.allow).toContain("Bash(npm:*)");
    expect(settings.permissions.allow).toContain("Bash(git:*)");
    expect(settings.permissions.deny).toContain("Bash(rm -rf:*)");
  });

  test("writes enabled plugins from skills.install", async () => {
    const profile: AgentProfile = {
      skills: {
        install: ["frontend-design@anthropic-agent-skills", "code-review@marketplace"],
      },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);

    const settings = JSON.parse(
      await readFile(join(TEST_DIR, ".claude", "settings.json"), "utf-8")
    );
    expect(settings.enabledPlugins["frontend-design@anthropic-agent-skills"]).toBe(true);
    expect(settings.enabledPlugins["code-review@marketplace"]).toBe(true);
  });

  test("writes extra marketplaces from skills.marketplaces", async () => {
    const profile: AgentProfile = {
      skills: {
        marketplaces: ["anthropics/skills", "myorg/custom-skills"],
      },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);

    const settings = JSON.parse(
      await readFile(join(TEST_DIR, ".claude", "settings.json"), "utf-8")
    );
    expect(settings.extraKnownMarketplaces).toBeDefined();
    expect(settings.extraKnownMarketplaces["anthropics-skills"]).toBeDefined();
    expect(settings.extraKnownMarketplaces["anthropics-skills"].source.repo).toBe(
      "anthropics/skills"
    );
  });

  test("copies local skill files", async () => {
    // Create a source skill directory with SKILL.md
    const skillDir = join(SKILLS_SOURCE_DIR, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\n---\n# My Skill"
    );

    const profile: AgentProfile = {
      skills: {
        local: [skillDir],
      },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);

    const copiedSkill = await readFile(
      join(TEST_DIR, ".claude", "skills", "my-skill", "SKILL.md"),
      "utf-8"
    );
    expect(copiedSkill).toContain("# My Skill");
  });

  test("combines all profile settings in single application", async () => {
    const profile: AgentProfile = {
      mcpServers: {
        playwright: {
          command: "npx",
          args: ["-y", "@anthropic/mcp-playwright"],
        },
      },
      permissions: {
        allow: ["Bash(playwright:*)"],
      },
      skills: {
        install: ["frontend-design@anthropic-agent-skills"],
        marketplaces: ["anthropics/skills"],
      },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);
    expect(result.filesWritten.length).toBeGreaterThanOrEqual(2);

    // Check MCP config
    const mcpConfig = JSON.parse(await readFile(join(TEST_DIR, ".mcp.json"), "utf-8"));
    expect(mcpConfig.mcpServers.playwright).toBeDefined();

    // Check settings
    const settings = JSON.parse(
      await readFile(join(TEST_DIR, ".claude", "settings.json"), "utf-8")
    );
    expect(settings.permissions.allow).toContain("Bash(playwright:*)");
    expect(settings.enabledPlugins["frontend-design@anthropic-agent-skills"]).toBe(true);
    expect(settings.extraKnownMarketplaces["anthropics-skills"]).toBeDefined();
  });

  test("handles empty profile gracefully", async () => {
    const profile: AgentProfile = {};

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);
    expect(result.filesWritten).toHaveLength(0);
  });

  test("creates .claude directory if it doesn't exist", async () => {
    const profile: AgentProfile = {
      permissions: { allow: ["Bash(test:*)"] },
    };

    const result = await applyProfileConfig(TEST_DIR, profile);

    expect(result.success).toBe(true);

    const claudeDirStat = await stat(join(TEST_DIR, ".claude"));
    expect(claudeDirStat.isDirectory()).toBe(true);
  });
});

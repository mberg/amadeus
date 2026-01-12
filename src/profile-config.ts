// ABOUTME: Writes agent profile configuration to worktree directories.
// ABOUTME: Creates .mcp.json, .claude/settings.json, and local skill files.

import { mkdir, copyFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { AgentProfile, McpServerConfig } from "./types";

export interface ProfileConfigResult {
  success: boolean;
  error?: string;
  filesWritten: string[];
}

/**
 * Writes MCP server configuration to .mcp.json in the target directory.
 */
async function writeMcpConfig(
  targetDir: string,
  mcpServers: Record<string, McpServerConfig>
): Promise<string | null> {
  const mcpConfigPath = join(targetDir, ".mcp.json");

  // Transform to Claude Code format (type: stdio for command-based servers)
  const mcpConfig: Record<string, unknown> = {
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers).map(([name, config]) => [
        name,
        {
          type: "stdio",
          command: config.command,
          args: config.args ?? [],
          env: config.env ?? {},
        },
      ])
    ),
  };

  await Bun.write(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  return mcpConfigPath;
}

/**
 * Writes permissions and plugin configuration to .claude/settings.json.
 */
async function writeSettingsConfig(
  targetDir: string,
  profile: AgentProfile
): Promise<string | null> {
  const claudeDir = join(targetDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");

  const settings: Record<string, unknown> = {};

  // Add permissions if defined
  if (profile.permissions) {
    settings.permissions = {
      ...(profile.permissions.allow && { allow: profile.permissions.allow }),
      ...(profile.permissions.deny && { deny: profile.permissions.deny }),
    };
  }

  // Add enabled plugins from skills.install
  if (profile.skills?.install?.length) {
    settings.enabledPlugins = Object.fromEntries(
      profile.skills.install.map((plugin) => [plugin, true])
    );
  }

  // Add extra marketplaces from skills.marketplaces
  if (profile.skills?.marketplaces?.length) {
    settings.extraKnownMarketplaces = Object.fromEntries(
      profile.skills.marketplaces.map((marketplace) => {
        // Parse marketplace format: "owner/repo" or just "name"
        const parts = marketplace.split("/");
        if (parts.length === 2) {
          return [
            marketplace.replace("/", "-"),
            {
              source: {
                source: "github",
                repo: marketplace,
              },
            },
          ];
        }
        return [marketplace, { source: { source: "github", repo: marketplace } }];
      })
    );
  }

  // Only write if there's content
  if (Object.keys(settings).length > 0) {
    await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
    return settingsPath;
  }

  return null;
}

/**
 * Copies local skill files to .claude/skills/ directory.
 */
async function copyLocalSkills(
  targetDir: string,
  localSkills: string[]
): Promise<string[]> {
  const skillsDir = join(targetDir, ".claude", "skills");
  await mkdir(skillsDir, { recursive: true });

  const copiedFiles: string[] = [];

  for (const skillPath of localSkills) {
    try {
      const skillStat = await stat(skillPath);

      if (skillStat.isDirectory()) {
        // Copy entire skill directory
        const skillName = basename(skillPath);
        const destDir = join(skillsDir, skillName);
        await mkdir(destDir, { recursive: true });

        const files = await readdir(skillPath);
        for (const file of files) {
          const srcFile = join(skillPath, file);
          const destFile = join(destDir, file);
          await copyFile(srcFile, destFile);
          copiedFiles.push(destFile);
        }
      } else {
        // Copy single file
        const destFile = join(skillsDir, basename(skillPath));
        await copyFile(skillPath, destFile);
        copiedFiles.push(destFile);
      }
    } catch (err) {
      console.warn(`[ProfileConfig] Failed to copy skill ${skillPath}:`, err);
    }
  }

  return copiedFiles;
}

/**
 * Applies an agent profile configuration to a target directory.
 * Creates necessary config files for MCP servers, permissions, and skills.
 */
export async function applyProfileConfig(
  targetDir: string,
  profile: AgentProfile
): Promise<ProfileConfigResult> {
  const filesWritten: string[] = [];

  try {
    // Write MCP server configuration
    if (profile.mcpServers && Object.keys(profile.mcpServers).length > 0) {
      const mcpPath = await writeMcpConfig(targetDir, profile.mcpServers);
      if (mcpPath) {
        filesWritten.push(mcpPath);
        console.log(`[ProfileConfig] Wrote MCP config: ${mcpPath}`);
      }
    }

    // Write settings (permissions + plugins)
    const settingsPath = await writeSettingsConfig(targetDir, profile);
    if (settingsPath) {
      filesWritten.push(settingsPath);
      console.log(`[ProfileConfig] Wrote settings: ${settingsPath}`);
    }

    // Copy local skills
    if (profile.skills?.local?.length) {
      const copied = await copyLocalSkills(targetDir, profile.skills.local);
      filesWritten.push(...copied);
      if (copied.length > 0) {
        console.log(`[ProfileConfig] Copied ${copied.length} local skill file(s)`);
      }
    }

    return { success: true, filesWritten };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[ProfileConfig] Failed to apply profile config:`, error);
    return { success: false, error, filesWritten };
  }
}

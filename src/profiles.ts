// ABOUTME: Loads and resolves agent profiles from JSON files.
// ABOUTME: Handles profile inheritance, merging, and label-based selection.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProfile, LinearIssue } from "./types";

export async function loadProfiles(
  profilesDir: string
): Promise<Record<string, AgentProfile>> {
  const profiles: Record<string, AgentProfile> = {};

  try {
    const files = await readdir(profilesDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const name = file.replace(".json", "");
      const path = join(profilesDir, file);
      const content = await Bun.file(path).text();
      profiles[name] = JSON.parse(content);
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return profiles;
}

export function resolveProfile(
  issue: LinearIssue,
  profiles: Record<string, AgentProfile>,
  defaultProfile: string
): string | string[] {
  const profileLabels =
    issue.labels
      ?.filter((l) => l.name.startsWith("profile:"))
      .map((l) => l.name.replace("profile:", ""))
      .filter((name) => profiles[name]) ?? [];

  if (profileLabels.length === 0) {
    return defaultProfile;
  }

  if (profileLabels.length === 1) {
    return profileLabels[0];
  }

  return profileLabels;
}

export function resolveSkillLabels(
  issue: LinearIssue,
  skillProfiles: Record<string, AgentProfile>
): string[] {
  if (!issue.labels) {
    return [];
  }

  const skillProfileNames = Object.keys(skillProfiles).map((name) =>
    name.toLowerCase()
  );

  const matchedSkills = issue.labels
    .filter((l) => !l.name.startsWith("profile:"))
    .map((l) => l.name.toLowerCase())
    .filter((labelName) => skillProfileNames.includes(labelName));

  return matchedSkills;
}

export function mergeSkillProfiles(
  baseProfile: AgentProfile,
  skillNames: string[],
  skillProfiles: Record<string, AgentProfile>
): AgentProfile {
  let result = { ...baseProfile };

  for (const skillName of skillNames) {
    const skillProfile = skillProfiles[skillName];
    if (skillProfile) {
      result = mergeProfiles(result, skillProfile);
    }
  }

  return result;
}

export function mergeProfiles(
  base: AgentProfile,
  child: AgentProfile
): AgentProfile {
  const merged: AgentProfile = {};

  // Merge MCP servers (child overrides base for same key)
  if (base.mcpServers || child.mcpServers) {
    merged.mcpServers = {
      ...base.mcpServers,
      ...child.mcpServers,
    };
  }

  // Merge permissions (combine arrays)
  if (base.permissions || child.permissions) {
    merged.permissions = {
      allow: [
        ...(base.permissions?.allow ?? []),
        ...(child.permissions?.allow ?? []),
      ],
      deny: [
        ...(base.permissions?.deny ?? []),
        ...(child.permissions?.deny ?? []),
      ],
    };
    // Remove empty arrays
    if (merged.permissions.allow?.length === 0) delete merged.permissions.allow;
    if (merged.permissions.deny?.length === 0) delete merged.permissions.deny;
  }

  // Merge prompt additions (combine arrays, base first)
  if (base.promptAdditions || child.promptAdditions) {
    merged.promptAdditions = [
      ...(base.promptAdditions ?? []),
      ...(child.promptAdditions ?? []),
    ];
  }

  // Merge skills (combine all arrays, dedupe)
  if (base.skills || child.skills) {
    merged.skills = {
      marketplaces: dedupe([
        ...(base.skills?.marketplaces ?? []),
        ...(child.skills?.marketplaces ?? []),
      ]),
      install: dedupe([
        ...(base.skills?.install ?? []),
        ...(child.skills?.install ?? []),
      ]),
      local: dedupe([
        ...(base.skills?.local ?? []),
        ...(child.skills?.local ?? []),
      ]),
    };
    // Remove empty arrays
    if (merged.skills.marketplaces?.length === 0)
      delete merged.skills.marketplaces;
    if (merged.skills.install?.length === 0) delete merged.skills.install;
    if (merged.skills.local?.length === 0) delete merged.skills.local;
  }

  return merged;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

export function resolveAndMergeProfiles(
  issue: LinearIssue,
  profiles: Record<string, AgentProfile>,
  defaultProfile: string
): AgentProfile {
  const resolved = resolveProfile(issue, profiles, defaultProfile);
  const profileNames = Array.isArray(resolved) ? resolved : [resolved];

  let result: AgentProfile = {};

  for (const name of profileNames) {
    const profile = profiles[name];
    if (!profile) continue;

    // Handle extends
    if (profile.extends && profiles[profile.extends]) {
      const parent = profiles[profile.extends];
      result = mergeProfiles(result, mergeProfiles(parent, profile));
    } else {
      result = mergeProfiles(result, profile);
    }
  }

  return result;
}

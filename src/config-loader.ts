// ABOUTME: Loads and validates Amadeus configuration from YAML files.
// ABOUTME: Resolves environment variable references and builds lookup maps.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import {
  AmadeusConfigSchema,
  type AmadeusConfig,
  type ResolvedConfig,
  type ResolvedRealm,
  type Project,
} from "./config-schema";

const CONFIG_FILE_NAMES = ["amadeus.config.yaml", "amadeus.config.yml", "amadeus.config.json"];

/**
 * Find the config file in the given directory.
 */
function findConfigFile(baseDir: string): string | null {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = join(baseDir, fileName);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Load and parse a config file (YAML or JSON).
 */
function loadConfigFile(filePath: string): unknown {
  const content = readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(content);
  }
  return yaml.load(content);
}

/**
 * Resolve an environment variable name to its value.
 * Throws if the variable is not set.
 */
function resolveEnvVar(envVarName: string, context: string): string {
  const value = process.env[envVarName];
  if (!value) {
    throw new Error(
      `Environment variable ${envVarName} is not set (required for ${context})`
    );
  }
  return value;
}

/**
 * Build the resolved configuration with lookup maps.
 */
function buildResolvedConfig(config: AmadeusConfig): ResolvedConfig {
  const resolvedRealms: ResolvedRealm[] = [];
  const realmByWorkspace = new Map<string, ResolvedRealm>();
  const realmByTeamKey = new Map<string, ResolvedRealm>();
  const projectByTeamKey = new Map<string, { realm: ResolvedRealm; project: Project }>();

  for (const [realmName, realm] of Object.entries(config.realms)) {
    const resolvedRealm: ResolvedRealm = {
      name: realmName,
      linearWorkspace: realm.linearWorkspace,
      apiKey: resolveEnvVar(realm.apiKeyEnvVar, `realm "${realmName}" API key`),
      webhookSecret: resolveEnvVar(realm.webhookSecretEnvVar, `realm "${realmName}" webhook secret`),
      claudeBotUserId: realm.claudeBotUserId,
      projects: realm.projects,
    };

    resolvedRealms.push(resolvedRealm);
    realmByWorkspace.set(realm.linearWorkspace, resolvedRealm);

    for (const project of realm.projects) {
      if (realmByTeamKey.has(project.teamKey)) {
        throw new Error(
          `Team key "${project.teamKey}" is defined in multiple realms. Each team key must be unique.`
        );
      }
      realmByTeamKey.set(project.teamKey, resolvedRealm);
      projectByTeamKey.set(project.teamKey, { realm: resolvedRealm, project });
    }
  }

  return {
    realms: resolvedRealms,
    global: config.global,
    realmByWorkspace,
    realmByTeamKey,
    projectByTeamKey,
  };
}

/**
 * Load configuration from amadeus.config.yaml.
 * Looks in the project root directory.
 */
export function loadConfig(baseDir?: string): ResolvedConfig {
  const dir = baseDir ?? resolve(import.meta.dir, "..");
  const configPath = findConfigFile(dir);

  if (!configPath) {
    throw new Error(
      `No configuration file found. Create one of: ${CONFIG_FILE_NAMES.join(", ")}\n` +
      `See amadeus.config.example.yaml for the required format.`
    );
  }

  const rawConfig = loadConfigFile(configPath) as Record<string, unknown> | null;

  // Ensure global is at least an empty object (Zod defaults need an object, not undefined)
  if (rawConfig && rawConfig.global === undefined) {
    rawConfig.global = {};
  }

  const parseResult = AmadeusConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid configuration in ${configPath}:\n${errors}`);
  }

  return buildResolvedConfig(parseResult.data);
}

/**
 * Check if new-style config file exists.
 */
export function hasNewStyleConfig(baseDir?: string): boolean {
  const dir = baseDir ?? resolve(import.meta.dir, "..");
  return findConfigFile(dir) !== null;
}

/**
 * Get the path to a project for a given team key.
 */
export function getProjectPath(config: ResolvedConfig, teamKey: string): string | null {
  const entry = config.projectByTeamKey.get(teamKey);
  return entry?.project.path ?? null;
}

/**
 * Get the realm for a given team key.
 */
export function getRealmForTeam(config: ResolvedConfig, teamKey: string): ResolvedRealm | null {
  return config.realmByTeamKey.get(teamKey) ?? null;
}

/**
 * Get the realm for a given Linear workspace.
 */
export function getRealmForWorkspace(config: ResolvedConfig, workspace: string): ResolvedRealm | null {
  return config.realmByWorkspace.get(workspace) ?? null;
}

/**
 * Get the profile for a given team key.
 * Falls back to global default profile if not specified on project.
 */
export function getProfileForTeam(config: ResolvedConfig, teamKey: string): string {
  const entry = config.projectByTeamKey.get(teamKey);
  return entry?.project.profile ?? config.global.defaultProfile;
}

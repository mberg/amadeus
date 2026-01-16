// ABOUTME: Loads and validates Amadeus configuration from YAML files.
// ABOUTME: Resolves environment variable references and builds lookup maps.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import {
  AmadeusConfigSchema,
  type AmadeusConfig,
  type ResolvedConfig,
  type ResolvedRealm,
  type ResolvedLinearRealm,
  type ResolvedGitHubRealm,
  type ResolvedRouterConfig,
  type Project,
  isLinearRealm,
  isGitHubRealm,
} from "./config-schema";

// Re-export types for consumers
export type { ResolvedConfig, ResolvedRealm, ResolvedLinearRealm, ResolvedGitHubRealm, ResolvedRouterConfig, Project } from "./config-schema";
export { isLinearRealm, isGitHubRealm } from "./config-schema";

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
    let resolvedRealm: ResolvedRealm;

    if (realm.type === "github") {
      // GitHub realm
      resolvedRealm = {
        type: "github",
        name: realmName,
        owner: realm.owner,
        repo: realm.repo,
        projectNumber: realm.projectNumber,
        token: resolveEnvVar(realm.tokenEnvVar, `realm "${realmName}" GitHub token`),
        webhookSecret: resolveEnvVar(realm.webhookSecretEnvVar, `realm "${realmName}" webhook secret`),
        botUserId: realm.botUserId,
        projects: realm.projects,
      };

      // For GitHub, use owner/repo as workspace key
      realmByWorkspace.set(`${realm.owner}/${realm.repo}`, resolvedRealm);
    } else {
      // Linear realm (type === "linear" or legacy without type)
      resolvedRealm = {
        type: "linear",
        name: realmName,
        linearWorkspace: realm.linearWorkspace,
        apiKey: resolveEnvVar(realm.apiKeyEnvVar, `realm "${realmName}" API key`),
        webhookSecret: resolveEnvVar(realm.webhookSecretEnvVar, `realm "${realmName}" webhook secret`),
        claudeBotUserId: realm.claudeBotUserId,
        projects: realm.projects,
      };

      realmByWorkspace.set(realm.linearWorkspace, resolvedRealm);
    }

    resolvedRealms.push(resolvedRealm);

    for (const project of realm.projects) {
      // Only error if the same team key is used in a different realm
      const existingRealm = realmByTeamKey.get(project.teamKey);
      if (existingRealm && existingRealm.name !== resolvedRealm.name) {
        throw new Error(
          `Team key "${project.teamKey}" is defined in multiple realms (${existingRealm.name} and ${resolvedRealm.name}). ` +
          `Use linearProject to distinguish projects within the same team.`
        );
      }
      realmByTeamKey.set(project.teamKey, resolvedRealm);
      projectByTeamKey.set(project.teamKey, { realm: resolvedRealm, project });
    }
  }

  // Resolve router config if present
  let resolvedRouter: ResolvedRouterConfig | undefined;
  if (config.global.router) {
    resolvedRouter = {
      url: config.global.router.url,
      machineName: config.global.router.machineName,
      secret: resolveEnvVar(config.global.router.secretEnvVar, "router secret"),
    };
  }

  return {
    realms: resolvedRealms,
    global: config.global,
    router: resolvedRouter,
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

/**
 * Get the path to the config file.
 */
export function getConfigFilePath(baseDir?: string): string | null {
  const dir = baseDir ?? resolve(import.meta.dir, "..");
  return findConfigFile(dir);
}

/**
 * Get the raw YAML content of the config file.
 */
export function getConfigYaml(baseDir?: string): string | null {
  const configPath = getConfigFilePath(baseDir);
  if (!configPath) return null;
  return readFileSync(configPath, "utf-8");
}

export type ConfigValidationResult =
  | { valid: true; config: ResolvedConfig }
  | { valid: false; errors: string[] };

/**
 * Validate YAML content without writing to disk.
 */
export function validateConfigYaml(yamlContent: string): ConfigValidationResult {
  try {
    const rawConfig = yaml.load(yamlContent) as Record<string, unknown> | null;

    if (rawConfig && rawConfig.global === undefined) {
      rawConfig.global = {};
    }

    const parseResult = AmadeusConfigSchema.safeParse(rawConfig);

    if (!parseResult.success) {
      const errors = parseResult.error.issues.map(
        (e) => `${e.path.join(".")}: ${e.message}`
      );
      return { valid: false, errors };
    }

    const resolved = buildResolvedConfig(parseResult.data);
    return { valid: true, config: resolved };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, errors: [message] };
  }
}

/**
 * Write new config content and return the resolved config.
 * Does not modify existing config - caller must update CONFIG/REALM_CONFIG.
 */
export function writeConfig(
  yamlContent: string,
  baseDir?: string
): ConfigValidationResult {
  const validation = validateConfigYaml(yamlContent);
  if (!validation.valid) {
    return validation;
  }

  const configPath = getConfigFilePath(baseDir);
  if (!configPath) {
    return { valid: false, errors: ["No config file found to update"] };
  }

  writeFileSync(configPath, yamlContent, "utf-8");
  return validation;
}

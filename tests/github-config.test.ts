// ABOUTME: Tests for GitHub realm configuration.
// ABOUTME: Tests config schema validation and loading for GitHub realms.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config-loader";
import { isGitHubRealm, isLinearRealm } from "../src/config-schema";

describe("GitHub Config", () => {
  let testDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "amadeus-github-config-tests"));
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  describe("GitHub realm schema", () => {
    it("loads valid GitHub realm config", () => {
      process.env.GITHUB_TOKEN_TEST = "test-token";
      process.env.GITHUB_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  github-test:
    type: github
    owner: testowner
    repo: testrepo
    projectNumber: 1
    tokenEnvVar: GITHUB_TOKEN_TEST
    webhookSecretEnvVar: GITHUB_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: DEFAULT
        path: /path/to/project
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.realms).toHaveLength(1);
      const realm = config.realms[0];
      expect(isGitHubRealm(realm)).toBe(true);
      if (isGitHubRealm(realm)) {
        expect(realm.type).toBe("github");
        expect(realm.owner).toBe("testowner");
        expect(realm.repo).toBe("testrepo");
        expect(realm.projectNumber).toBe(1);
        expect(realm.token).toBe("test-token");
        expect(realm.webhookSecret).toBe("test-secret");
      }
    });

    it("loads GitHub realm without projectNumber", () => {
      process.env.GITHUB_TOKEN_TEST = "test-token";
      process.env.GITHUB_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  github-test:
    type: github
    owner: testowner
    repo: testrepo
    tokenEnvVar: GITHUB_TOKEN_TEST
    webhookSecretEnvVar: GITHUB_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: DEFAULT
        path: /path/to/project
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);
      const realm = config.realms[0];
      expect(isGitHubRealm(realm)).toBe(true);
      if (isGitHubRealm(realm)) {
        expect(realm.projectNumber).toBeUndefined();
      }
    });

    it("throws for missing required fields", () => {
      process.env.GITHUB_TOKEN_TEST = "test-token";
      process.env.GITHUB_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  github-test:
    type: github
    owner: testowner
    # missing repo
    tokenEnvVar: GITHUB_TOKEN_TEST
    webhookSecretEnvVar: GITHUB_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: DEFAULT
        path: /path/to/project
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/Invalid configuration/);
    });
  });

  describe("Mixed realm config", () => {
    it("loads config with both Linear and GitHub realms", () => {
      process.env.LINEAR_API_KEY_TEST = "linear-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "linear-secret";
      process.env.GITHUB_TOKEN_TEST = "github-token";
      process.env.GITHUB_WEBHOOK_SECRET_TEST = "github-secret";

      const configYaml = `
realms:
  linear-realm:
    type: linear
    linearWorkspace: testworkspace
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: LINEAR
        path: /path/to/linear-project

  github-realm:
    type: github
    owner: testowner
    repo: testrepo
    tokenEnvVar: GITHUB_TOKEN_TEST
    webhookSecretEnvVar: GITHUB_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: GITHUB
        path: /path/to/github-project
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.realms).toHaveLength(2);

      const linearRealm = config.realms.find((r) => r.name === "linear-realm");
      const githubRealm = config.realms.find((r) => r.name === "github-realm");

      expect(linearRealm).toBeDefined();
      expect(githubRealm).toBeDefined();

      expect(isLinearRealm(linearRealm!)).toBe(true);
      expect(isGitHubRealm(githubRealm!)).toBe(true);
    });

    it("creates correct workspace lookups for both realm types", () => {
      process.env.LINEAR_API_KEY_TEST = "linear-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "linear-secret";
      process.env.GITHUB_TOKEN_TEST = "github-token";
      process.env.GITHUB_WEBHOOK_SECRET_TEST = "github-secret";

      const configYaml = `
realms:
  linear-realm:
    linearWorkspace: testworkspace
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: LINEAR
        path: /path/to/linear-project

  github-realm:
    type: github
    owner: testowner
    repo: testrepo
    tokenEnvVar: GITHUB_TOKEN_TEST
    webhookSecretEnvVar: GITHUB_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: GITHUB
        path: /path/to/github-project
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      // Linear workspace lookup
      expect(config.realmByWorkspace.get("testworkspace")).toBeDefined();
      expect(config.realmByWorkspace.get("testworkspace")?.name).toBe("linear-realm");

      // GitHub workspace lookup (owner/repo)
      expect(config.realmByWorkspace.get("testowner/testrepo")).toBeDefined();
      expect(config.realmByWorkspace.get("testowner/testrepo")?.name).toBe("github-realm");
    });
  });

  describe("Legacy config compatibility", () => {
    it("loads legacy config without type field as Linear", () => {
      process.env.LINEAR_API_KEY_TEST = "linear-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "linear-secret";

      const configYaml = `
realms:
  legacy-realm:
    linearWorkspace: testworkspace
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: DEFAULT
        path: /path/to/project
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.realms).toHaveLength(1);
      const realm = config.realms[0];
      expect(isLinearRealm(realm)).toBe(true);
      if (isLinearRealm(realm)) {
        expect(realm.type).toBe("linear");
        expect(realm.linearWorkspace).toBe("testworkspace");
      }
    });
  });
});

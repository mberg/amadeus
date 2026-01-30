// ABOUTME: Tests for the Amadeus config loader.
// ABOUTME: Tests YAML config loading, validation, and realm resolution.

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, hasNewStyleConfig, getProjectPath, getRealmForTeam, getProfileForTeam } from "../src/config-loader";

describe("Config Loader", () => {
  const testDir = "/tmp/amadeus-config-tests";

  beforeEach(() => {
    // Create test directory
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    rmSync(testDir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.LINEAR_API_KEY_TEST;
    delete process.env.LINEAR_WEBHOOK_SECRET_TEST;
  });

  describe("hasNewStyleConfig", () => {
    it("returns false when no config file exists", () => {
      expect(hasNewStyleConfig(testDir)).toBe(false);
    });

    it("returns true when amadeus.config.yaml exists", () => {
      writeFileSync(join(testDir, "amadeus.config.yaml"), "realms: {}\n");
      expect(hasNewStyleConfig(testDir)).toBe(true);
    });

    it("returns true when amadeus.config.yml exists", () => {
      writeFileSync(join(testDir, "amadeus.config.yml"), "realms: {}\n");
      expect(hasNewStyleConfig(testDir)).toBe(true);
    });

    it("returns true when amadeus.config.json exists", () => {
      writeFileSync(join(testDir, "amadeus.config.json"), '{"realms": {}}');
      expect(hasNewStyleConfig(testDir)).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("throws when no config file exists", () => {
      expect(() => loadConfig(testDir)).toThrow(/No configuration file found/);
    });

    it("loads valid YAML config", () => {
      process.env.LINEAR_API_KEY_TEST = "test-api-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-webhook-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test-workspace
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /path/to/test
        profile: base
global:
  port: 8080
  triggerStates:
    - Planning
    - Building
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.realms.length).toBe(1);
      expect(config.realms[0].name).toBe("test");
      expect(config.realms[0].linearWorkspace).toBe("test-workspace");
      expect(config.realms[0].apiKey).toBe("test-api-key");
      expect(config.realms[0].webhookSecret).toBe("test-webhook-secret");
      expect(config.realms[0].projects.length).toBe(1);
      expect(config.global.port).toBe(8080);
      expect(config.global.triggerStates).toEqual(["Planning", "Building"]);
    });

    it("loads valid JSON config", () => {
      process.env.LINEAR_API_KEY_TEST = "json-api-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "json-webhook-secret";

      const configJson = {
        realms: {
          test: {
            linearWorkspace: "json-workspace",
            apiKeyEnvVar: "LINEAR_API_KEY_TEST",
            webhookSecretEnvVar: "LINEAR_WEBHOOK_SECRET_TEST",
            projects: [{ teamKey: "JSON", path: "/path/to/json" }],
          },
        },
      };
      writeFileSync(join(testDir, "amadeus.config.json"), JSON.stringify(configJson));

      const config = loadConfig(testDir);

      expect(config.realms.length).toBe(1);
      expect(config.realms[0].linearWorkspace).toBe("json-workspace");
      expect(config.realms[0].apiKey).toBe("json-api-key");
    });

    it("applies default values for global config", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /test
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.global.port).toBe(5678);
      expect(config.global.triggerStates).toEqual(["Planning"]);
      expect(config.global.useWorktrees).toBe(true);
      expect(config.global.defaultProfile).toBe("base");
      expect(config.global.healthCheckIntervalMs).toBe(30000);
      expect(config.global.healthCheckTimeoutMs).toBe(5000);
      expect(config.global.runtimeMode).toBe("standalone");
    });

    it("accepts hub runtime mode", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /test
global:
  runtimeMode: hub
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.global.runtimeMode).toBe("hub");
    });

    it("accepts machine runtime mode", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /test
global:
  runtimeMode: machine
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(config.global.runtimeMode).toBe("machine");
    });

    it("rejects invalid runtime mode", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /test
global:
  runtimeMode: invalid
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/Invalid configuration/);
    });

    it("accepts machineUrl for project forwarding", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: LOCAL
        path: /local
      - teamKey: REMOTE
        path: /remote
        machineUrl: https://amadeus-remote-abc123.sprites.app
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      const localProject = config.projectByTeamKey.get("LOCAL");
      const remoteProject = config.projectByTeamKey.get("REMOTE");

      expect(localProject?.project.machineUrl).toBeUndefined();
      expect(remoteProject?.project.machineUrl).toBe("https://amadeus-remote-abc123.sprites.app");
    });

    it("rejects invalid machineUrl", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /test
        machineUrl: not-a-valid-url
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/Invalid configuration/);
    });

    it("throws when env var is not set", () => {
      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: NONEXISTENT_API_KEY
    webhookSecretEnvVar: NONEXISTENT_SECRET
    projects:
      - teamKey: TEST
        path: /test
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/Environment variable NONEXISTENT_API_KEY is not set/);
    });

    it("throws on invalid config structure", () => {
      const configYaml = `
realms:
  test:
    linearWorkspace: test
    # Missing required fields
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/Invalid configuration/);
    });

    it("throws when realm has no projects", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects: []
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/At least one project required/);
    });

    it("throws when team key is duplicated across realms", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  realm1:
    linearWorkspace: ws1
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: DUPE
        path: /path1
  realm2:
    linearWorkspace: ws2
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: DUPE
        path: /path2
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      expect(() => loadConfig(testDir)).toThrow(/Team key "DUPE" is defined in multiple realms/);
    });

    it("builds lookup maps correctly", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  ona:
    linearWorkspace: ona-workspace
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: ONA
        path: /path/to/ona
        profile: base
      - teamKey: DESIGN
        path: /path/to/design
        profile: frontend
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      // Test workspace lookup
      const realmByWorkspace = config.realmByWorkspace.get("ona-workspace");
      expect(realmByWorkspace?.name).toBe("ona");

      // Test team key lookup
      const realmByTeam = config.realmByTeamKey.get("ONA");
      expect(realmByTeam?.name).toBe("ona");

      // Test project lookup
      const projectEntry = config.projectByTeamKey.get("DESIGN");
      expect(projectEntry?.project.path).toBe("/path/to/design");
      expect(projectEntry?.project.profile).toBe("frontend");
    });
  });

  describe("helper functions", () => {
    it("getProjectPath returns correct path", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /path/to/test
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(getProjectPath(config, "TEST")).toBe("/path/to/test");
      expect(getProjectPath(config, "NONEXISTENT")).toBeNull();
    });

    it("getRealmForTeam returns correct realm", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test-ws
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: TEST
        path: /test
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      const realm = getRealmForTeam(config, "TEST");
      expect(realm?.linearWorkspace).toBe("test-ws");
      expect(realm?.apiKey).toBe("test-key");
      expect(getRealmForTeam(config, "NONEXISTENT")).toBeNull();
    });

    it("getProfileForTeam returns project profile or default", () => {
      process.env.LINEAR_API_KEY_TEST = "test-key";
      process.env.LINEAR_WEBHOOK_SECRET_TEST = "test-secret";

      const configYaml = `
realms:
  test:
    linearWorkspace: test
    apiKeyEnvVar: LINEAR_API_KEY_TEST
    webhookSecretEnvVar: LINEAR_WEBHOOK_SECRET_TEST
    projects:
      - teamKey: CUSTOM
        path: /custom
        profile: custom-profile
      - teamKey: DEFAULT
        path: /default
global:
  defaultProfile: fallback
`;
      writeFileSync(join(testDir, "amadeus.config.yaml"), configYaml);

      const config = loadConfig(testDir);

      expect(getProfileForTeam(config, "CUSTOM")).toBe("custom-profile");
      expect(getProfileForTeam(config, "DEFAULT")).toBe("fallback");
      expect(getProfileForTeam(config, "NONEXISTENT")).toBe("fallback");
    });
  });
});

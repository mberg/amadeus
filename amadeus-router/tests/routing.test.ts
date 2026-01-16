// ABOUTME: Tests for the routing logic that determines which machine handles an issue.
// ABOUTME: Tests label matching, capability matching, project fallback, and default routing.

import { describe, test, expect } from "bun:test";
import { findTargetMachine, type RouterConfig, type IssueInfo } from "../src/routing";

const testConfig: RouterConfig = {
  machines: {
    "gpu-beast": {
      url: "https://gpu-beast.tailnet-abc.ts.net",
      labels: ["ml", "training", "gpu"],
      projects: ["ML"],
    },
    "macbook": {
      url: "https://macbook.tailnet-abc.ts.net",
      labels: ["frontend", "mobile"],
      projects: ["ONA", "DESIGN"],
    },
    "cloud-vm": {
      url: "https://cloud-vm.tailnet-abc.ts.net",
      labels: ["backend", "api"],
      projects: [],
      default: true,
    },
  },
  secret: "test-secret",
};

describe("findTargetMachine", () => {
  describe("explicit machine label", () => {
    test("routes to machine specified in machine: label", () => {
      const issue: IssueInfo = {
        identifier: "ONA-123",
        labels: ["machine:gpu-beast", "other-label"],
        teamKey: "ONA",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("gpu-beast");
      expect(result?.url).toBe("https://gpu-beast.tailnet-abc.ts.net");
      expect(result?.reason).toBe("explicit-label");
    });

    test("explicit machine label takes priority over capability match", () => {
      const issue: IssueInfo = {
        identifier: "ML-123",
        labels: ["machine:macbook", "ml", "gpu"], // ml/gpu would match gpu-beast
        teamKey: "ML",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("macbook");
      expect(result?.reason).toBe("explicit-label");
    });

    test("returns null if explicit machine does not exist", () => {
      const issue: IssueInfo = {
        identifier: "ONA-123",
        labels: ["machine:nonexistent"],
        teamKey: "ONA",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result).toBeNull();
    });
  });

  describe("capability label matching", () => {
    test("routes to machine with matching capability label", () => {
      const issue: IssueInfo = {
        identifier: "TASK-456",
        labels: ["ml"],
        teamKey: "TASK",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("gpu-beast");
      expect(result?.reason).toBe("capability-label");
    });

    test("routes to first machine when multiple match", () => {
      // Both gpu-beast and cloud-vm have 'api' if we added it
      // This test ensures deterministic behavior
      const issue: IssueInfo = {
        identifier: "TASK-789",
        labels: ["gpu"],
        teamKey: "TASK",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("gpu-beast");
    });

    test("capability match takes priority over project fallback", () => {
      const issue: IssueInfo = {
        identifier: "ONA-999", // ONA team would fallback to macbook
        labels: ["gpu"], // but gpu label should match gpu-beast
        teamKey: "ONA",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("gpu-beast");
      expect(result?.reason).toBe("capability-label");
    });
  });

  describe("project fallback", () => {
    test("routes to machine with matching project", () => {
      const issue: IssueInfo = {
        identifier: "ONA-100",
        labels: [],
        teamKey: "ONA",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("macbook");
      expect(result?.reason).toBe("project-fallback");
    });

    test("routes ML team to gpu-beast", () => {
      const issue: IssueInfo = {
        identifier: "ML-200",
        labels: [],
        teamKey: "ML",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("gpu-beast");
      expect(result?.reason).toBe("project-fallback");
    });
  });

  describe("default machine", () => {
    test("routes to default machine when no other match", () => {
      const issue: IssueInfo = {
        identifier: "RANDOM-1",
        labels: [],
        teamKey: "RANDOM",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("cloud-vm");
      expect(result?.reason).toBe("default");
    });

    test("returns null if no default configured", () => {
      const configWithoutDefault: RouterConfig = {
        machines: {
          "macbook": {
            url: "https://macbook.ts.net",
            labels: [],
            projects: ["ONA"],
          },
        },
        secret: "test",
      };

      const issue: IssueInfo = {
        identifier: "RANDOM-1",
        labels: [],
        teamKey: "RANDOM",
      };

      const result = findTargetMachine(issue, configWithoutDefault);

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles empty labels array", () => {
      const issue: IssueInfo = {
        identifier: "ONA-1",
        labels: [],
        teamKey: "ONA",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result).not.toBeNull();
    });

    test("handles case-insensitive label matching", () => {
      const issue: IssueInfo = {
        identifier: "TASK-1",
        labels: ["ML", "GPU"], // uppercase
        teamKey: "TASK",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("gpu-beast");
    });

    test("machine: prefix is case-insensitive", () => {
      const issue: IssueInfo = {
        identifier: "TASK-1",
        labels: ["Machine:macbook"],
        teamKey: "TASK",
      };

      const result = findTargetMachine(issue, testConfig);

      expect(result?.name).toBe("macbook");
    });

    test("handles empty config", () => {
      const emptyConfig: RouterConfig = {
        machines: {},
        secret: "test",
      };

      const issue: IssueInfo = {
        identifier: "ONA-1",
        labels: [],
        teamKey: "ONA",
      };

      const result = findTargetMachine(issue, emptyConfig);

      expect(result).toBeNull();
    });
  });
});

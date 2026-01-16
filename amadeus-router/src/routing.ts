// ABOUTME: Routing logic for determining which machine should handle an issue.
// ABOUTME: Implements label matching, capability matching, project fallback, and default routing.

export interface MachineConfig {
  url: string;
  labels: string[];
  projects: string[];
  default?: boolean;
}

export interface RouterConfig {
  machines: Record<string, MachineConfig>;
  secret: string;
}

export interface IssueInfo {
  identifier: string;
  labels: string[];
  teamKey: string;
}

export type RoutingReason =
  | "explicit-label"
  | "capability-label"
  | "project-fallback"
  | "default";

export interface RoutingResult {
  name: string;
  url: string;
  reason: RoutingReason;
}

export function findTargetMachine(
  issue: IssueInfo,
  config: RouterConfig
): RoutingResult | null {
  const machineEntries = Object.entries(config.machines);

  if (machineEntries.length === 0) {
    return null;
  }

  const lowercaseLabels = issue.labels.map((l) => l.toLowerCase());

  // Priority 1: Explicit machine label (machine:name)
  for (const label of lowercaseLabels) {
    if (label.startsWith("machine:")) {
      const machineName = label.slice("machine:".length);
      const machine = config.machines[machineName];

      if (machine) {
        return {
          name: machineName,
          url: machine.url,
          reason: "explicit-label",
        };
      }

      // Explicit machine specified but doesn't exist - return null
      return null;
    }
  }

  // Priority 2: Capability label match
  for (const [name, machine] of machineEntries) {
    const machineLabels = machine.labels.map((l) => l.toLowerCase());

    for (const issueLabel of lowercaseLabels) {
      if (machineLabels.includes(issueLabel)) {
        return {
          name,
          url: machine.url,
          reason: "capability-label",
        };
      }
    }
  }

  // Priority 3: Project fallback
  const uppercaseTeamKey = issue.teamKey.toUpperCase();
  for (const [name, machine] of machineEntries) {
    const upperProjects = machine.projects.map((p) => p.toUpperCase());
    if (upperProjects.includes(uppercaseTeamKey)) {
      return {
        name,
        url: machine.url,
        reason: "project-fallback",
      };
    }
  }

  // Priority 4: Default machine
  for (const [name, machine] of machineEntries) {
    if (machine.default) {
      return {
        name,
        url: machine.url,
        reason: "default",
      };
    }
  }

  return null;
}

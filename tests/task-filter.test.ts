// ABOUTME: Tests for task filtering functionality.
// ABOUTME: Verifies search and filter logic for dashboard tasks.

import { describe, expect, it } from "bun:test";
import {
  filterTasks,
  filterCompletedTasks,
  collectUniqueSkills,
  type FilterOptions,
} from "../src/dashboard/lib/filter";
import type { Task, CompletedTask } from "../src/dashboard/types";

const mockTasks: Task[] = [
  {
    key: "task-1",
    port: 3001,
    issueId: "id-1",
    issueIdentifier: "ONA-100",
    issueTitle: "Add user authentication",
    linearState: "Building",
    activeSkills: ["frontend-design", "playwright"],
    status: "working",
    uptime: 1000,
  },
  {
    key: "task-2",
    port: 3002,
    issueId: "id-2",
    issueIdentifier: "ONA-101",
    issueTitle: "Fix login bug",
    linearState: "Review",
    activeSkills: ["playwright"],
    status: "idle",
    uptime: 2000,
  },
  {
    key: "task-3",
    port: 3003,
    issueId: "id-3",
    issueIdentifier: "ONA-102",
    issueTitle: "Dashboard improvements",
    linearState: "Planning",
    activeSkills: [],
    status: "starting",
    uptime: 500,
  },
];

const mockCompletedTasks: CompletedTask[] = [
  {
    key: "completed-1",
    issueId: "id-10",
    issueIdentifier: "ONA-50",
    issueTitle: "Setup CI pipeline",
    completedAt: "2024-01-01T12:00:00Z",
    completionReason: "done",
    finalLinearState: "Done",
    duration: 3600000,
  },
  {
    key: "completed-2",
    issueId: "id-11",
    issueIdentifier: "ONA-51",
    issueTitle: "Add authentication tests",
    completedAt: "2024-01-02T12:00:00Z",
    completionReason: "stopped",
    finalLinearState: "Review",
    duration: 1800000,
  },
];

describe("filterTasks", () => {
  it("returns all tasks when no filters applied", () => {
    const result = filterTasks(mockTasks, {});
    expect(result).toHaveLength(3);
  });

  it("filters by search query matching issueIdentifier", () => {
    const result = filterTasks(mockTasks, { searchQuery: "ONA-100" });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-100");
  });

  it("filters by search query matching issueTitle (case-insensitive)", () => {
    const result = filterTasks(mockTasks, { searchQuery: "authentication" });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-100");
  });

  it("filters by search query partial match", () => {
    const result = filterTasks(mockTasks, { searchQuery: "bug" });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-101");
  });

  it("filters by single state", () => {
    const result = filterTasks(mockTasks, { states: ["Building"] });
    expect(result).toHaveLength(1);
    expect(result[0].linearState).toBe("Building");
  });

  it("filters by multiple states", () => {
    const result = filterTasks(mockTasks, { states: ["Building", "Review"] });
    expect(result).toHaveLength(2);
  });

  it("filters by single skill", () => {
    const result = filterTasks(mockTasks, { skills: ["frontend-design"] });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-100");
  });

  it("filters by multiple skills (OR logic - matches any)", () => {
    const result = filterTasks(mockTasks, {
      skills: ["frontend-design", "playwright"],
    });
    expect(result).toHaveLength(2);
  });

  it("combines search and state filters with AND logic", () => {
    const result = filterTasks(mockTasks, {
      searchQuery: "ONA",
      states: ["Building"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-100");
  });

  it("combines all filters with AND logic", () => {
    const result = filterTasks(mockTasks, {
      searchQuery: "ONA",
      states: ["Building", "Review"],
      skills: ["playwright"],
    });
    expect(result).toHaveLength(2);
  });

  it("returns empty array when no matches", () => {
    const result = filterTasks(mockTasks, { searchQuery: "nonexistent" });
    expect(result).toHaveLength(0);
  });

  it("handles empty states array as no filter", () => {
    const result = filterTasks(mockTasks, { states: [] });
    expect(result).toHaveLength(3);
  });

  it("handles empty skills array as no filter", () => {
    const result = filterTasks(mockTasks, { skills: [] });
    expect(result).toHaveLength(3);
  });
});

describe("filterCompletedTasks", () => {
  it("returns all completed tasks when no filters applied", () => {
    const result = filterCompletedTasks(mockCompletedTasks, {});
    expect(result).toHaveLength(2);
  });

  it("filters by search query matching issueIdentifier", () => {
    const result = filterCompletedTasks(mockCompletedTasks, {
      searchQuery: "ONA-50",
    });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-50");
  });

  it("filters by search query matching issueTitle", () => {
    const result = filterCompletedTasks(mockCompletedTasks, {
      searchQuery: "authentication",
    });
    expect(result).toHaveLength(1);
    expect(result[0].issueIdentifier).toBe("ONA-51");
  });

  it("filters by finalLinearState", () => {
    const result = filterCompletedTasks(mockCompletedTasks, {
      states: ["Done"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].finalLinearState).toBe("Done");
  });

  it("ignores skills filter (completed tasks have no skills)", () => {
    const result = filterCompletedTasks(mockCompletedTasks, {
      skills: ["frontend-design"],
    });
    expect(result).toHaveLength(2);
  });
});

describe("collectUniqueSkills", () => {
  it("collects unique skills from all tasks", () => {
    const skills = collectUniqueSkills(mockTasks);
    expect(skills).toContain("frontend-design");
    expect(skills).toContain("playwright");
    expect(skills).toHaveLength(2);
  });

  it("returns empty array when no tasks have skills", () => {
    const tasks: Task[] = [
      { ...mockTasks[0], activeSkills: undefined },
      { ...mockTasks[1], activeSkills: [] },
    ];
    const skills = collectUniqueSkills(tasks);
    expect(skills).toHaveLength(0);
  });

  it("returns sorted skills alphabetically", () => {
    const skills = collectUniqueSkills(mockTasks);
    expect(skills[0]).toBe("frontend-design");
    expect(skills[1]).toBe("playwright");
  });
});

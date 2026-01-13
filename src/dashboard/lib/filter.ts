// ABOUTME: Task filtering utilities for the dashboard.
// ABOUTME: Provides functions to filter tasks by search query, state, and skills.

import type { Task, CompletedTask } from "../types";

export interface FilterOptions {
  searchQuery?: string;
  states?: string[];
  skills?: string[];
}

function matchesSearchQuery(
  searchQuery: string,
  issueIdentifier: string,
  issueTitle: string
): boolean {
  const query = searchQuery.toLowerCase();
  return (
    issueIdentifier.toLowerCase().includes(query) ||
    issueTitle.toLowerCase().includes(query)
  );
}

export function filterTasks(tasks: Task[], options: FilterOptions): Task[] {
  const { searchQuery, states, skills } = options;

  return tasks.filter((task) => {
    // Search query filter
    if (searchQuery && searchQuery.trim()) {
      if (!matchesSearchQuery(searchQuery, task.issueIdentifier, task.issueTitle)) {
        return false;
      }
    }

    // State filter
    if (states && states.length > 0) {
      if (!task.linearState || !states.includes(task.linearState)) {
        return false;
      }
    }

    // Skills filter (OR logic - task must have at least one of the selected skills)
    if (skills && skills.length > 0) {
      const taskSkills = task.activeSkills || [];
      if (!skills.some((skill) => taskSkills.includes(skill))) {
        return false;
      }
    }

    return true;
  });
}

export function filterCompletedTasks(
  tasks: CompletedTask[],
  options: FilterOptions
): CompletedTask[] {
  const { searchQuery, states } = options;
  // Note: skills filter is ignored for completed tasks as they don't track skills

  return tasks.filter((task) => {
    // Search query filter
    if (searchQuery && searchQuery.trim()) {
      if (!matchesSearchQuery(searchQuery, task.issueIdentifier, task.issueTitle)) {
        return false;
      }
    }

    // State filter (uses finalLinearState)
    if (states && states.length > 0) {
      if (!task.finalLinearState || !states.includes(task.finalLinearState)) {
        return false;
      }
    }

    return true;
  });
}

export function collectUniqueSkills(tasks: Task[]): string[] {
  const skillSet = new Set<string>();

  for (const task of tasks) {
    if (task.activeSkills) {
      for (const skill of task.activeSkills) {
        skillSet.add(skill);
      }
    }
  }

  return Array.from(skillSet).sort();
}

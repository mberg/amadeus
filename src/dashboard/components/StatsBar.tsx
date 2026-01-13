// ABOUTME: Statistics bar showing task counts.
// ABOUTME: Displays total, working, and idle task counts in compact cards.

import type { Task } from "../types";

interface StatsBarProps {
  tasks: Task[];
  completedCount?: number;
}

interface StatCardProps {
  value: number | string;
  label: string;
}

function StatCard({ value, label }: StatCardProps) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-foreground">
          {value}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

export function StatsBar({ tasks, completedCount = 0 }: StatsBarProps) {
  const totalTasks = tasks.length;
  const workingTasks = tasks.filter((t) => t.status === "working").length;
  const idleTasks = tasks.filter((t) => t.status === "idle").length;
  const totalMemoryMB = tasks.reduce((sum, t) => sum + (t.memoryMB ?? 0), 0);

  return (
    <div className="mb-6 flex gap-3">
      <StatCard value={totalTasks} label="Active" />
      <StatCard value={workingTasks} label="Working" />
      <StatCard value={idleTasks} label="Idle" />
      <StatCard value={completedCount} label="Completed" />
      {totalMemoryMB > 0 && (
        <StatCard value={formatMemory(totalMemoryMB)} label="Memory" />
      )}
    </div>
  );
}

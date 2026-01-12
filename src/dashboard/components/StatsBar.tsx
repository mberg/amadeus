// ABOUTME: Statistics bar showing task counts.
// ABOUTME: Displays total, working, and idle task counts in compact cards.

import type { Task } from "../types";

interface StatsBarProps {
  tasks: Task[];
}

interface StatCardProps {
  value: number;
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

export function StatsBar({ tasks }: StatsBarProps) {
  const totalTasks = tasks.length;
  const workingTasks = tasks.filter((t) => t.status === "working").length;
  const idleTasks = tasks.filter((t) => t.status === "idle").length;

  return (
    <div className="mb-6 flex gap-3">
      <StatCard value={totalTasks} label="Total" />
      <StatCard value={workingTasks} label="Working" />
      <StatCard value={idleTasks} label="Idle" />
    </div>
  );
}

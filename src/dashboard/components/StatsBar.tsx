// ABOUTME: Statistics bar showing task counts.
// ABOUTME: Displays total, working, and idle task counts.

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
    <div className="rounded-xl border border-border bg-secondary px-6 py-4 text-center">
      <div className="text-3xl font-semibold text-primary">{value}</div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function StatsBar({ tasks }: StatsBarProps) {
  const totalTasks = tasks.length;
  const workingTasks = tasks.filter((t) => t.status === "working").length;
  const idleTasks = tasks.filter((t) => t.status === "idle").length;

  return (
    <div className="mb-8 flex flex-wrap justify-center gap-4">
      <StatCard value={totalTasks} label="Total Tasks" />
      <StatCard value={workingTasks} label="Working" />
      <StatCard value={idleTasks} label="Idle" />
    </div>
  );
}

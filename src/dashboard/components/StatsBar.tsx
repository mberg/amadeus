// ABOUTME: Statistics bar showing task counts.
// ABOUTME: Displays total, working, and idle task counts.

import type { Task } from "../types";

interface StatsBarProps {
  tasks: Task[];
}

interface StatCardProps {
  value: number;
  label: string;
  description?: string;
}

function StatCard({ value, label, description }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="mt-2">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </div>
    </div>
  );
}

export function StatsBar({ tasks }: StatsBarProps) {
  const totalTasks = tasks.length;
  const workingTasks = tasks.filter((t) => t.status === "working").length;
  const idleTasks = tasks.filter((t) => t.status === "idle").length;

  return (
    <div className="mb-6 grid gap-4 md:grid-cols-3">
      <StatCard
        value={totalTasks}
        label="Total Tasks"
        description="Active agent instances"
      />
      <StatCard
        value={workingTasks}
        label="Working"
        description="Currently processing"
      />
      <StatCard
        value={idleTasks}
        label="Idle"
        description="Waiting for input"
      />
    </div>
  );
}

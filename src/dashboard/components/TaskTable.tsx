// ABOUTME: Task data table component using TanStack Table.
// ABOUTME: Displays all running tasks with sorting, filtering, and actions.

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useState, useCallback } from "react";
import { StopTaskDialog } from "./StopTaskDialog";
import {
  ArrowUpDown,
  ExternalLink,
  Square,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { Task, CompletedTask } from "../types";
import { formatUptime, getStateVariant } from "../lib/utils";

interface TaskTableProps {
  tasks: Task[];
  completedTasks: CompletedTask[];
  showCompleted: boolean;
  onToggleCompleted: () => void;
  linearWorkspace?: string;
  onSelectTask: (task: Task) => void;
  onStopTask: (taskKey: string) => void;
  onLoadMoreCompleted: () => void;
  hasMoreCompleted: boolean;
}

function getStatusVariant(status: string): "idle" | "working" | "starting" {
  if (status === "idle") return "idle";
  if (status === "working") return "working";
  if (status === "starting") return "starting";
  return "idle";
}

function formatCompletionReason(reason: string): string {
  switch (reason) {
    case "done":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "canceled":
      return "Canceled";
    case "backlog":
      return "Backlogged";
    default:
      return reason;
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}


export function TaskTable({
  tasks,
  completedTasks,
  showCompleted,
  onToggleCompleted,
  linearWorkspace,
  onSelectTask,
  onStopTask,
  onLoadMoreCompleted,
  hasMoreCompleted,
}: TaskTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "uptime", desc: false }, // Newest (lowest uptime) on top
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [taskToStop, setTaskToStop] = useState<Task | null>(null);

  const handleStopConfirm = useCallback(() => {
    if (taskToStop) {
      onStopTask(taskToStop.key);
      setTaskToStop(null);
    }
  }, [taskToStop, onStopTask]);

  const columns: ColumnDef<Task>[] = [
    {
      accessorKey: "issueIdentifier",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2 hover:bg-transparent"
        >
          ID
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.getValue("issueIdentifier")}
        </span>
      ),
    },
    {
      accessorKey: "pid",
      header: "PID",
      cell: ({ row }) => {
        const pid = row.getValue("pid") as number | undefined;
        return (
          <span className="text-muted-foreground tabular-nums text-sm">
            {pid ?? "-"}
          </span>
        );
      },
    },
    {
      accessorKey: "memoryMB",
      header: "Memory",
      cell: ({ row }) => {
        const memoryMB = row.getValue("memoryMB") as number | undefined;
        return (
          <span className="text-muted-foreground tabular-nums text-sm">
            {memoryMB !== undefined ? `${memoryMB} MB` : "-"}
          </span>
        );
      },
    },
    {
      accessorKey: "issueTitle",
      header: "Title",
      cell: ({ row }) => (
        <span className="max-w-[400px] truncate text-muted-foreground">
          {row.getValue("issueTitle")}
        </span>
      ),
    },
    {
      accessorKey: "activeSkills",
      header: "Skills",
      cell: ({ row }) => {
        const skills = row.getValue("activeSkills") as string[] | undefined;
        if (!skills || skills.length === 0) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {skills.map((skill) => (
              <Badge key={skill} variant="outline" className="text-xs">
                {skill}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2 hover:bg-transparent"
        >
          Status
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        return (
          <Badge variant={getStatusVariant(status)} className="gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "working"
                  ? "bg-chart-1 animate-pulse-dot"
                  : status === "starting"
                    ? "bg-chart-3 animate-pulse-dot"
                    : "bg-chart-2"
              }`}
            />
            {status}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
    },
    {
      accessorKey: "linearState",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2 hover:bg-transparent"
        >
          State
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const state = row.getValue("linearState") as string | undefined;
        if (!state) return <span className="text-muted-foreground">-</span>;
        return <Badge variant={getStateVariant(state)}>{state}</Badge>;
      },
      filterFn: (row, id, value) => {
        const state = row.getValue(id) as string | undefined;
        if (!state) return false;
        return value.some((v: string) =>
          state.toLowerCase().includes(v.toLowerCase())
        );
      },
    },
    {
      accessorKey: "uptime",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2 hover:bg-transparent"
        >
          Uptime
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {formatUptime(row.getValue("uptime"))}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const task = row.original;
        const linearUrl = linearWorkspace
          ? `https://linear.app/${linearWorkspace}/issue/${task.issueIdentifier}`
          : null;

        return (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onSelectTask(task);
              }}
              title="View Messages"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            {linearUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(linearUrl, "_blank", "noopener,noreferrer");
                }}
                title="Open in Linear"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                setTaskToStop(task);
              }}
              title="Stop Task"
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  const table = useReactTable({
    data: tasks,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
    },
  });

  return (
    <div className="space-y-4">
      {/* Active Tasks */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer group"
                  onClick={() => onSelectTask(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <div className="text-muted-foreground">
                    <span className="text-sm">No active tasks</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Completed Tasks Section */}
      {completedTasks.length > 0 && (
        <div className="rounded-lg border border-border bg-card/50">
          {/* Collapsible Header */}
          <button
            onClick={onToggleCompleted}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCompleted ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <CheckCircle2 className="h-4 w-4" />
            <span>Completed Tasks</span>
            <span className="text-xs text-muted-foreground/60">
              ({completedTasks.length})
            </span>
          </button>

          {showCompleted && (
            <div className="border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Final State</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completedTasks.map((task) => {
                    const linearUrl = linearWorkspace
                      ? `https://linear.app/${linearWorkspace}/issue/${task.issueIdentifier}`
                      : null;

                    return (
                      <TableRow
                        key={`${task.issueId}-${task.completedAt}`}
                        className="opacity-60 hover:opacity-80 transition-opacity"
                      >
                        <TableCell className="px-4">
                          <span className="font-medium text-foreground">
                            {task.issueIdentifier}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="max-w-[350px] truncate text-muted-foreground">
                            {task.issueTitle}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={task.completionReason === "done" ? "done" : "default"}
                            className="text-xs"
                          >
                            {formatCompletionReason(task.completionReason)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {task.finalLinearState ? (
                            <Badge variant={getStateVariant(task.finalLinearState)} className="text-xs">
                              {task.finalLinearState}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground tabular-nums text-sm">
                            {formatUptime(task.duration)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-muted-foreground text-sm">
                            {formatTimeAgo(task.completedAt)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {linearUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 opacity-50 hover:opacity-100"
                              onClick={() => window.open(linearUrl, "_blank", "noopener,noreferrer")}
                              title="Open in Linear"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {hasMoreCompleted && (
                <div className="flex justify-center py-3 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onLoadMoreCompleted}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <StopTaskDialog
        open={taskToStop !== null}
        onOpenChange={(open) => !open && setTaskToStop(null)}
        taskIdentifier={taskToStop?.issueIdentifier ?? ""}
        onConfirm={handleStopConfirm}
      />
    </div>
  );
}

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
import { useState } from "react";
import {
  ArrowUpDown,
  MoreHorizontal,
  ExternalLink,
  Square,
  MessageSquare,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { Task } from "../types";
import { formatUptime } from "../lib/utils";

interface TaskTableProps {
  tasks: Task[];
  linearWorkspace?: string;
  onSelectTask: (task: Task) => void;
  onStopTask: (taskKey: string) => void;
}

function getStatusVariant(status: string): "idle" | "working" | "starting" {
  if (status === "idle") return "idle";
  if (status === "working") return "working";
  if (status === "starting") return "starting";
  return "idle";
}

function getStateVariant(
  state: string | undefined
): "planning" | "building" | "feedback" | "review" | "done" | "default" {
  if (!state) return "default";
  const lower = state.toLowerCase();
  if (lower.includes("planning") || lower.includes("scoping")) return "planning";
  if (lower.includes("building")) return "building";
  if (lower.includes("feedback")) return "feedback";
  if (lower.includes("review")) return "review";
  if (lower.includes("done")) return "done";
  return "default";
}

export function TaskTable({
  tasks,
  linearWorkspace,
  onSelectTask,
  onStopTask,
}: TaskTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

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
      accessorKey: "issueTitle",
      header: "Title",
      cell: ({ row }) => (
        <span className="max-w-[300px] truncate text-muted-foreground">
          {row.getValue("issueTitle")}
        </span>
      ),
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onSelectTask(task)}>
                <MessageSquare className="mr-2 h-4 w-4" />
                View Messages
              </DropdownMenuItem>
              {linearUrl && (
                <DropdownMenuItem asChild>
                  <a href={linearUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Linear
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (
                    window.confirm(
                      `Stop task for ${task.issueIdentifier}? This will terminate the task and remove the worktree.`
                    )
                  ) {
                    onStopTask(task.key);
                  }
                }}
                className="text-destructive focus:text-destructive"
              >
                <Square className="mr-2 h-4 w-4" />
                Stop Task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                className="cursor-pointer"
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
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <span className="text-4xl opacity-50">🎼</span>
                  <span>No active tasks</span>
                  <span className="text-sm">
                    Tasks will appear here when Linear issues trigger them
                  </span>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

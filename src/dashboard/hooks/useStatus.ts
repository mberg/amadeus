// ABOUTME: React hook for polling task status from the API.
// ABOUTME: Handles automatic refresh and provides loading/error states.

import { useState, useEffect, useCallback } from "react";
import type { Task, CompletedTask, DashboardConfig, StatusResponse, HistoryResponse } from "../types";

const POLL_INTERVAL = 2000; // 2 seconds
const HISTORY_PAGE_SIZE = 20;

interface HubStatusResponse {
  machines: Array<{
    name: string;
    url: string;
    status: "healthy" | "unhealthy" | "unknown";
    agents: Task[];
  }>;
  timestamp: string;
}

interface UseStatusReturn {
  tasks: Task[];
  completedTasks: CompletedTask[];
  completedTotal: number;
  config: DashboardConfig;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMoreCompleted: () => Promise<void>;
  hasMoreCompleted: boolean;
}

export function useStatus(): UseStatusReturn {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedOffset, setCompletedOffset] = useState(0);
  const [config, setConfig] = useState<DashboardConfig>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/config");
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      }
    } catch (err) {
      console.error("Failed to fetch config:", err);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      // In hub/standalone mode, aggregate tasks from all machines
      const isAggregateMode = config.runtimeMode === "hub" || config.runtimeMode === "standalone";

      if (isAggregateMode) {
        const response = await fetch("/hub/status");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data: HubStatusResponse = await response.json();

        // Flatten all machines' agents with machine name and URL
        const allTasks: Task[] = data.machines.flatMap(machine =>
          machine.agents.map(agent => ({
            ...agent,
            machineName: machine.name,
            machineUrl: machine.url,
          }))
        );

        setTasks(allTasks);
        setLastUpdated(new Date(data.timestamp));
      } else {
        // Machine mode or unknown - fetch local only
        const response = await fetch("/status");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data: StatusResponse = await response.json();
        setTasks(data.agents);
        setLastUpdated(new Date(data.timestamp));
      }
      setError(null);
    } catch (err) {
      console.error("Failed to fetch status:", err);
      setError("Failed to fetch status");
    } finally {
      setIsLoading(false);
    }
  }, [config.runtimeMode]);

  const fetchHistory = useCallback(async (offset: number = 0) => {
    try {
      const response = await fetch(`/status/history?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: HistoryResponse = await response.json();
      if (offset === 0) {
        setCompletedTasks(data.completedTasks);
      } else {
        setCompletedTasks((prev) => [...prev, ...data.completedTasks]);
      }
      setCompletedTotal(data.total);
      setCompletedOffset(offset);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  }, []);

  const loadMoreCompleted = useCallback(async () => {
    const newOffset = completedOffset + HISTORY_PAGE_SIZE;
    await fetchHistory(newOffset);
  }, [completedOffset, fetchHistory]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchStatus(), fetchHistory(0)]);
  }, [fetchStatus, fetchHistory]);

  // Initial fetch
  useEffect(() => {
    fetchConfig();
    fetchStatus();
    fetchHistory(0);
  }, [fetchConfig, fetchStatus, fetchHistory]);

  // Polling interval (only for active tasks, not history)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
      // Also refresh history periodically to catch newly completed tasks
      fetchHistory(0);
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchHistory]);

  const hasMoreCompleted = completedTasks.length < completedTotal;

  return {
    tasks,
    completedTasks,
    completedTotal,
    config,
    lastUpdated,
    isLoading,
    error,
    refresh,
    loadMoreCompleted,
    hasMoreCompleted,
  };
}

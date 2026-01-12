// ABOUTME: React hook for polling task status from the API.
// ABOUTME: Handles automatic refresh and provides loading/error states.

import { useState, useEffect, useCallback } from "react";
import type { Task, DashboardConfig, StatusResponse } from "../types";

const POLL_INTERVAL = 2000; // 2 seconds

interface UseStatusReturn {
  tasks: Task[];
  config: DashboardConfig;
  lastUpdated: Date | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useStatus(): UseStatusReturn {
  const [tasks, setTasks] = useState<Task[]>([]);
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
      const response = await fetch("/status");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: StatusResponse = await response.json();
      setTasks(data.agents);
      setLastUpdated(new Date(data.timestamp));
      setError(null);
    } catch (err) {
      console.error("Failed to fetch status:", err);
      setError("Failed to fetch status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchStatus();
  }, [fetchStatus]);

  // Initial fetch
  useEffect(() => {
    fetchConfig();
    fetchStatus();
  }, [fetchConfig, fetchStatus]);

  // Polling interval
  useEffect(() => {
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return {
    tasks,
    config,
    lastUpdated,
    isLoading,
    error,
    refresh,
  };
}

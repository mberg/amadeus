// ABOUTME: Main React application component for the dashboard.
// ABOUTME: Manages task selection state and renders the main layout.

import { useState, useCallback } from "react";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { TaskTable } from "./components/TaskTable";
import { MessagePanel } from "./components/MessagePanel";
import { useStatus } from "./hooks/useStatus";
import type { Task } from "./types";

export function App() {
  const { tasks, config, lastUpdated } = useStatus();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedTask(null);
  }, []);

  const handleStopTask = useCallback(async (taskKey: string) => {
    try {
      const response = await fetch(`/agents/${encodeURIComponent(taskKey)}/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        console.error("Failed to stop task:", response.status);
        alert("Failed to stop task");
      }
      // If we stopped the task we're viewing, close the panel
      if (selectedTask?.key === taskKey) {
        setSelectedTask(null);
      }
    } catch (error) {
      console.error("Failed to stop task:", error);
      alert("Failed to stop task");
    }
  }, [selectedTask]);

  return (
    <div className="mx-auto min-h-screen max-w-5xl p-8">
      <Header />
      <StatsBar tasks={tasks} />

      <TaskTable
        tasks={tasks}
        linearWorkspace={config.linearWorkspace}
        onSelectTask={handleSelectTask}
        onStopTask={handleStopTask}
      />

      {/* Last updated indicator */}
      <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground/50" />
        Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "-"}
      </div>

      {/* Message panel */}
      <MessagePanel task={selectedTask} onClose={handleClosePanel} />
    </div>
  );
}

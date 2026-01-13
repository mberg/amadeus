// ABOUTME: Main React application component for the dashboard.
// ABOUTME: Manages task selection state and renders the main layout.

import { useState, useCallback, useMemo } from "react";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { TaskTable } from "./components/TaskTable";
import { MessagePanel } from "./components/MessagePanel";
import { SearchFilterBar } from "./components/SearchFilterBar";
import { useStatus } from "./hooks/useStatus";
import { collectUniqueSkills } from "./lib/filter";
import type { Task } from "./types";

export function App() {
  const { tasks, completedTasks, completedTotal, config, lastUpdated, loadMoreCompleted, hasMoreCompleted } = useStatus();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  const availableSkills = useMemo(() => collectUniqueSkills(tasks), [tasks]);

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

  const handleToggleCompleted = useCallback(() => {
    setShowCompleted((prev) => !prev);
  }, []);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[90%] px-4 py-6 md:px-6 md:py-8">
      <Header />
      <StatsBar tasks={tasks} completedCount={completedTotal} />

      <SearchFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedStates={selectedStates}
        onStatesChange={setSelectedStates}
        selectedSkills={selectedSkills}
        onSkillsChange={setSelectedSkills}
        availableSkills={availableSkills}
      />

      <TaskTable
        tasks={tasks}
        completedTasks={completedTasks}
        showCompleted={showCompleted}
        onToggleCompleted={handleToggleCompleted}
        linearWorkspace={config.linearWorkspace}
        onSelectTask={handleSelectTask}
        onStopTask={handleStopTask}
        onLoadMoreCompleted={loadMoreCompleted}
        hasMoreCompleted={hasMoreCompleted}
        searchQuery={searchQuery}
        selectedStates={selectedStates}
        selectedSkills={selectedSkills}
      />

      <div className="mt-4 text-xs text-muted-foreground/60">
        {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
      </div>

      <MessagePanel task={selectedTask} onClose={handleClosePanel} />
    </div>
  );
}

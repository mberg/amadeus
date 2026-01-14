// ABOUTME: Main React application component for the dashboard.
// ABOUTME: Manages task selection state and renders the sidebar layout.

import { useState, useCallback, useMemo } from "react";
import { Sidebar, type NavItem } from "./components/Sidebar";
import { StatsBar } from "./components/StatsBar";
import { TaskTable } from "./components/TaskTable";
import { MessagePanel } from "./components/MessagePanel";
import { SearchFilterBar } from "./components/SearchFilterBar";
import { SetupPanel } from "./components/SetupPanel";
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
  const [activeNav, setActiveNav] = useState<NavItem>("tasks");

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
    <div className="min-h-screen bg-background">
      <Sidebar activeItem={activeNav} onNavigate={setActiveNav} />

      {/* Main content area - offset by sidebar width */}
      <main className="ml-56 min-h-screen">
        <div className="mx-auto max-w-[1400px] px-6 py-6">
          {activeNav === "tasks" && (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-semibold text-foreground">Tasks</h1>
                <p className="text-sm text-muted-foreground">
                  Monitor and manage running agents
                </p>
              </div>

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
            </>
          )}

          {activeNav === "setup" && (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-semibold text-foreground">Setup</h1>
                <p className="text-sm text-muted-foreground">
                  View configured realms and projects
                </p>
              </div>

              <SetupPanel setup={config.setup} />
            </>
          )}
        </div>
      </main>

      <MessagePanel task={selectedTask} onClose={handleClosePanel} />
    </div>
  );
}

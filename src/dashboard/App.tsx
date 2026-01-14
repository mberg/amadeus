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
import { cn } from "./lib/utils";
import type { Task } from "./types";

export function App() {
  const { tasks, completedTasks, completedTotal, config, lastUpdated, loadMoreCompleted, hasMoreCompleted } = useStatus();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [activeNav, setActiveNav] = useState<NavItem>("tasks");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
      <Sidebar
        activeItem={activeNav}
        onNavigate={setActiveNav}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      {/* Main content area - offset by sidebar width */}
      <main className={cn("transition-all duration-300", sidebarCollapsed ? "pl-16" : "pl-52")}>
        <div className="min-h-screen p-8">
          {activeNav === "tasks" && (
            <div className="space-y-6">
              {/* Page Header */}
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
                <p className="text-muted-foreground">
                  Monitor and manage running agents
                </p>
              </div>

              {/* Stats Cards */}
              <StatsBar tasks={tasks} completedCount={completedTotal} />

              {/* Search and Filters */}
              <SearchFilterBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedStates={selectedStates}
                onStatesChange={setSelectedStates}
                selectedSkills={selectedSkills}
                onSkillsChange={setSelectedSkills}
                availableSkills={availableSkills}
              />

              {/* Task Table */}
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

              {/* Last Updated */}
              <div className="text-xs text-muted-foreground">
                {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : ""}
              </div>
            </div>
          )}

          {activeNav === "settings" && (
            <div className="space-y-6">
              {/* Page Header */}
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                <p className="text-muted-foreground">
                  View configured realms and projects
                </p>
              </div>

              {/* Settings Content */}
              <SetupPanel setup={config.setup} />
            </div>
          )}
        </div>
      </main>

      <MessagePanel task={selectedTask} onClose={handleClosePanel} />
    </div>
  );
}

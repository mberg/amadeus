// ABOUTME: Main React application component for the dashboard.
// ABOUTME: Manages task selection state and renders the sidebar layout with mobile responsiveness.

import { useState, useCallback, useMemo } from "react";
import { Sidebar, MobileMenuButton, type NavItem } from "./components/Sidebar";
import { StatsBar } from "./components/StatsBar";
import { TaskTable } from "./components/TaskTable";
import { MessagePanel } from "./components/MessagePanel";
import { SearchFilterBar } from "./components/SearchFilterBar";
import { SettingsPage } from "./components/SettingsPage";
import { MachinesView } from "./components/MachinesView";
import { AdminView } from "./components/AdminView";
import { AccountPage } from "./components/AccountPage";
import { useStatus } from "./hooks/useStatus";
import { useAuth } from "./components/AuthProvider";
import { collectUniqueSkills } from "./lib/filter";
import { cn } from "./lib/utils";
import type { Task, RuntimeMode } from "./types";

function getMachineTypeLabel(mode?: RuntimeMode): string {
  switch (mode) {
    case "machine": return "Sprite";
    case "hub": return "Hub";
    case "standalone": return "Local";
    default: return "Local";
  }
}

export function App() {
  const { tasks, completedTasks, completedTotal, config, lastUpdated, loadMoreCompleted, hasMoreCompleted } = useStatus();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [activeNav, setActiveNav] = useState<NavItem>("tasks");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const availableSkills = useMemo(() => collectUniqueSkills(tasks), [tasks]);

  const handleSelectTask = useCallback((task: Task) => {
    setSelectedTask(task);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedTask(null);
  }, []);

  const handleStopTask = useCallback(async (taskKey: string, machineUrl?: string) => {
    try {
      let response: Response;

      if (machineUrl) {
        // Remote task - queue stop via hub (delivered on next heartbeat)
        response = await fetch("/hub/proxy/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineUrl, taskKey }),
        });
      } else {
        // Local task
        response = await fetch(`/agents/${encodeURIComponent(taskKey)}/stop`, {
          method: "POST",
        });
      }

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
        runtimeMode={config.runtimeMode}
        mobileOpen={mobileMenuOpen}
        onMobileOpenChange={setMobileMenuOpen}
      />

      {/* Main content area - offset by sidebar width on desktop, full width on mobile */}
      <main className={cn(
        "transition-all duration-300",
        // Desktop: offset by sidebar width
        sidebarCollapsed ? "md:pl-16" : "md:pl-52",
        // Mobile: no offset (sidebar is a drawer overlay)
        "pl-0"
      )}>
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-4 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
            <span className="text-base font-semibold tracking-tight">Amadeus</span>
          </div>
          {config.machineName && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{config.machineName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500 text-white shadow-[0_0_8px_rgba(34,197,94,0.6)]">
                {getMachineTypeLabel(config.runtimeMode)}
              </span>
            </div>
          )}
        </div>

        {/* Desktop machine identity header */}
        {config.machineName && (
          <div className="hidden md:flex items-center justify-end px-8 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{config.machineName}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500 text-white shadow-[0_0_8px_rgba(34,197,94,0.6)] dark:shadow-[0_0_10px_rgba(34,197,94,0.5)]">
                {getMachineTypeLabel(config.runtimeMode)}
              </span>
            </div>
          </div>
        )}

        <div className="min-h-screen p-4 md:p-8">
          {activeNav === "tasks" && (
            <div className="space-y-4 md:space-y-6">
              {/* Page Header */}
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight">Tasks</h1>
                <p className="text-sm md:text-base text-muted-foreground">
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

          {activeNav === "machines" && <MachinesView />}

          {activeNav === "admin" && <AdminView />}

          {activeNav === "account" && <AccountPage />}

          {activeNav === "settings" && (
            <SettingsPage setup={config.setup} />
          )}
        </div>
      </main>

      <MessagePanel task={selectedTask} onClose={handleClosePanel} />
    </div>
  );
}

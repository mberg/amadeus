// ABOUTME: Sidebar navigation component for the dashboard.
// ABOUTME: Contains logo and navigation items for Tasks and Setup views.

import { LayoutDashboard, Settings, Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

export type NavItem = "tasks" | "setup";

interface SidebarProps {
  activeItem: NavItem;
  onNavigate: (item: NavItem) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ activeItem, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-border bg-background transition-all duration-300",
        collapsed ? "w-16" : "w-52"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo - clickable to toggle */}
        <button
          onClick={onToggleCollapse}
          className="flex h-14 items-center gap-2.5 px-4 hover:bg-muted/50 transition-colors"
        >
          <Activity className="h-5 w-5 text-foreground shrink-0" />
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight">Amadeus</span>
          )}
          <div className={cn("ml-auto", collapsed && "hidden")}>
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Navigation */}
        <nav className="flex-1 px-3 pt-4">
          {!collapsed && (
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              Menu
            </div>
          )}
          <div className="space-y-1">
            <button
              onClick={() => onNavigate("tasks")}
              title="Tasks"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "tasks"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              {!collapsed && "Tasks"}
            </button>
            <button
              onClick={() => onNavigate("setup")}
              title="Setup"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "setup"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {!collapsed && "Setup"}
            </button>
          </div>
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="border-t border-border px-5 py-4">
            <p className="text-xs text-muted-foreground/50">
              Agent Orchestrator
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

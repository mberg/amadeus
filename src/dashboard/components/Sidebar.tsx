// ABOUTME: Sidebar navigation component for the dashboard.
// ABOUTME: Contains logo and navigation items for Tasks and Settings views.

import { Activity, Settings, Blocks, Sun, Moon } from "lucide-react";
import { cn } from "../lib/utils";
import { useTheme } from "./ThemeProvider";

export type NavItem = "tasks" | "settings";

interface SidebarProps {
  activeItem: NavItem;
  onNavigate: (item: NavItem) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ activeItem, onNavigate, collapsed, onToggleCollapse }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen overflow-hidden border-r border-border bg-background transition-all duration-300",
        collapsed ? "w-16" : "w-52"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo - clickable to toggle */}
        <button
          onClick={onToggleCollapse}
          className={cn(
            "flex h-14 items-center gap-2.5 hover:bg-muted/50 transition-colors",
            collapsed ? "justify-center px-2" : "px-4"
          )}
        >
          <Blocks className="h-5 w-5 text-foreground shrink-0" />
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight">Amadeus</span>
          )}
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
              <Activity className="h-4 w-4 shrink-0" />
              {!collapsed && "Tasks"}
            </button>
            <button
              onClick={() => onNavigate("settings")}
              title="Settings"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "settings"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {!collapsed && "Settings"}
            </button>
          </div>
        </nav>

        {/* Footer */}
        <div className={cn(
          "border-t border-border py-3",
          collapsed ? "px-3" : "px-4"
        )}>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted/30 hover:text-foreground w-full",
              collapsed && "justify-center px-2"
            )}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 shrink-0" />
            ) : (
              <Moon className="h-4 w-4 shrink-0" />
            )}
            {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
          </button>
        </div>
      </div>
    </aside>
  );
}

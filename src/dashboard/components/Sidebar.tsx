// ABOUTME: Sidebar navigation component for the dashboard.
// ABOUTME: Contains logo and navigation items for Tasks and Setup views.

import { LayoutDashboard, Settings, Music } from "lucide-react";
import { cn } from "../lib/utils";

export type NavItem = "tasks" | "setup";

interface SidebarProps {
  activeItem: NavItem;
  onNavigate: (item: NavItem) => void;
}

export function Sidebar({ activeItem, onNavigate }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Music className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">Amadeus</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          <button
            onClick={() => onNavigate("tasks")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeItem === "tasks"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            Tasks
          </button>
          <button
            onClick={() => onNavigate("setup")}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeItem === "setup"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            Setup
          </button>
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <p className="text-xs text-muted-foreground/60">
            Agent Orchestrator
          </p>
        </div>
      </div>
    </aside>
  );
}

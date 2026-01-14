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
    <aside className="fixed left-0 top-0 z-40 h-screen w-52 border-r border-border bg-background">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Music className="h-4 w-4 text-primary" />
          </div>
          <span className="text-base font-semibold tracking-tight">Amadeus</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pt-4">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
            Menu
          </div>
          <div className="space-y-1">
            <button
              onClick={() => onNavigate("tasks")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "tasks"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
              Tasks
            </button>
            <button
              onClick={() => onNavigate("setup")}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "setup"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Settings className="h-4 w-4" />
              Setup
            </button>
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs text-muted-foreground/50">
            Agent Orchestrator
          </p>
        </div>
      </div>
    </aside>
  );
}

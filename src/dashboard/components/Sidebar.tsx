// ABOUTME: Sidebar navigation component for the dashboard.
// ABOUTME: Contains logo, navigation items, theme toggle, and user menu.

import { ListTodo, Settings, Blocks, Sun, Moon, Server, User } from "lucide-react";
import { cn } from "../lib/utils";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "./AuthProvider";
import { UserMenu, SignOutButton } from "./UserMenu";
import type { RuntimeMode } from "../types";

export type NavItem = "tasks" | "machines" | "settings" | "account";

interface SidebarProps {
  activeItem: NavItem;
  onNavigate: (item: NavItem) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  runtimeMode?: RuntimeMode;
}

export function Sidebar({ activeItem, onNavigate, collapsed, onToggleCollapse, runtimeMode }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { isSignedIn } = useAuth();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen overflow-hidden border-r border-border bg-background transition-all duration-300",
        collapsed ? "w-16" : "w-52"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo and machine name - clickable to toggle */}
        <button
          onClick={onToggleCollapse}
          className={cn(
            "flex h-14 items-center gap-2.5 hover:bg-muted/50 transition-colors",
            collapsed ? "justify-center px-2" : "px-4"
          )}
        >
          <Blocks className="h-5 w-5 text-foreground shrink-0" />
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight leading-tight">Amadeus</span>
          )}
        </button>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col px-3 pt-4">
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
              <ListTodo className="h-4 w-4 shrink-0" />
              {!collapsed && "Tasks"}
            </button>
            {runtimeMode !== "machine" && (
              <button
                onClick={() => onNavigate("machines")}
                title="Machines"
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  activeItem === "machines"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  collapsed && "justify-center px-2"
                )}
              >
                <Server className="h-4 w-4 shrink-0" />
                {!collapsed && "Machines"}
              </button>
            )}
            {runtimeMode !== "hub" && (
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
            )}

            {isSignedIn && (
              <button
                onClick={() => onNavigate("account")}
                title="Account"
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  activeItem === "account"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                  collapsed && "justify-center px-2"
                )}
              >
                <User className="h-4 w-4 shrink-0" />
                {!collapsed && "Account"}
              </button>
            )}

            {/* Theme toggle in nav area */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted/30 hover:text-foreground",
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

          {/* Sign out - pushed to bottom of nav, just above the border */}
          <div className="mt-auto pb-2">
            <SignOutButton collapsed={collapsed} />
          </div>
        </nav>

        {/* User Info Footer */}
        <div className={cn(
          "border-t border-border py-3",
          collapsed ? "px-3" : "px-4"
        )}>
          <UserMenu collapsed={collapsed} />
        </div>
      </div>
    </aside>
  );
}

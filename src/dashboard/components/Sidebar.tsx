// ABOUTME: Sidebar navigation component for the dashboard.
// ABOUTME: Contains logo, navigation items, theme toggle, and user menu. Supports mobile off-canvas drawer.

import { useEffect } from "react";
import { ListTodo, Settings, Blocks, Sun, Moon, Server, Shield, User, Menu, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useTheme } from "./ThemeProvider";
import { useAuth } from "./AuthProvider";
import { UserMenu, SignOutButton } from "./UserMenu";
import type { RuntimeMode } from "../types";

export type NavItem = "tasks" | "machines" | "settings" | "admin" | "account";

interface SidebarProps {
  activeItem: NavItem;
  onNavigate: (item: NavItem) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  runtimeMode?: RuntimeMode;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({ activeItem, onNavigate, collapsed, onToggleCollapse, runtimeMode, mobileOpen, onMobileOpenChange }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { isSignedIn } = useAuth();

  // Close mobile drawer on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        onMobileOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onMobileOpenChange]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const handleNavigate = (item: NavItem) => {
    onNavigate(item);
    onMobileOpenChange(false);
  };

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo - clickable to toggle on desktop, close on mobile */}
      <button
        onClick={() => {
          // On mobile, close the drawer. On desktop, toggle collapse.
          if (window.innerWidth < 768) {
            onMobileOpenChange(false);
          } else {
            onToggleCollapse();
          }
        }}
        className={cn(
          "flex h-14 items-center gap-2.5 hover:bg-muted/50 transition-colors",
          collapsed ? "justify-center px-2 md:justify-center" : "px-4"
        )}
      >
        <Blocks className="h-5 w-5 text-foreground shrink-0" />
        {/* Always show text on mobile (drawer is full-width enough), respect collapsed on desktop */}
        <span className={cn(
          "text-base font-semibold tracking-tight leading-tight",
          collapsed ? "hidden md:hidden" : "block"
        )}>
          Amadeus
        </span>
      </button>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col px-3 pt-4">
        <div className="space-y-1">
          <button
            onClick={() => handleNavigate("tasks")}
            title="Tasks"
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeItem === "tasks"
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              collapsed && "md:justify-center md:px-2"
            )}
          >
            <ListTodo className="h-4 w-4 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Tasks</span>
          </button>
          {runtimeMode !== "machine" && (
            <button
              onClick={() => handleNavigate("machines")}
              title="Machines"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "machines"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "md:justify-center md:px-2"
              )}
            >
              <Server className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>Machines</span>
            </button>
          )}
          {runtimeMode !== "hub" && (
            <button
              onClick={() => handleNavigate("settings")}
              title="Settings"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "settings"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "md:justify-center md:px-2"
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>Settings</span>
            </button>
          )}

          {runtimeMode !== "machine" && (
            <button
              onClick={() => handleNavigate("admin")}
              title="Admin"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "admin"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "md:justify-center md:px-2"
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>Admin</span>
            </button>
          )}

          {isSignedIn && (
            <button
              onClick={() => handleNavigate("account")}
              title="Account"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeItem === "account"
                  ? "bg-muted/50 text-foreground"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                collapsed && "md:justify-center md:px-2"
              )}
            >
              <User className="h-4 w-4 shrink-0" />
              <span className={cn(collapsed && "md:hidden")}>Account</span>
            </button>
          )}

          {/* Theme toggle in nav area */}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              collapsed && "md:justify-center md:px-2"
            )}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 shrink-0" />
            ) : (
              <Moon className="h-4 w-4 shrink-0" />
            )}
            <span className={cn(collapsed && "md:hidden")}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </span>
          </button>
        </div>

        {/* Sign out - pushed to bottom of nav */}
        <div className="mt-auto pb-2">
          <SignOutButton collapsed={collapsed} />
        </div>
      </nav>

      {/* User Info Footer */}
      <div className={cn(
        "border-t border-border py-3",
        collapsed ? "px-3 md:px-3" : "px-4"
      )}>
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => onMobileOpenChange(false)}
        />
      )}

      {/* Sidebar - desktop: fixed, mobile: off-canvas drawer */}
      <aside
        className={cn(
          // Desktop: always visible, fixed
          "fixed left-0 top-0 z-50 h-screen overflow-hidden border-r border-border bg-background transition-all duration-300",
          // Desktop width based on collapsed state
          collapsed ? "md:w-16" : "md:w-52",
          // Mobile: slide in/out as drawer
          "w-64 -translate-x-full md:translate-x-0",
          mobileOpen && "translate-x-0"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

/** Hamburger button shown on mobile to open the sidebar drawer */
export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-muted/50 transition-colors"
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5 text-foreground" />
    </button>
  );
}

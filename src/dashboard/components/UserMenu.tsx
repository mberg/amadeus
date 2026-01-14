// ABOUTME: User menu component showing avatar, role badge, and sign out.
// ABOUTME: Only displayed when Clerk authentication is enabled.

import { useState, useRef, useEffect } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { LogOut, User, Shield, Eye, Wrench } from "lucide-react";
import { useAuth, type UserRole } from "./AuthProvider";
import { cn } from "../lib/utils";

interface UserMenuProps {
  collapsed: boolean;
}

const roleIcons: Record<UserRole, typeof Shield> = {
  admin: Shield,
  operator: Wrench,
  viewer: Eye,
};

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

function ClerkUserMenu({ collapsed, role }: { collapsed: boolean; role: UserRole }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isLoaded || !user) {
    return null;
  }

  const RoleIcon = roleIcons[role];
  const roleLabel = roleLabels[role];

  const handleSignOut = () => {
    signOut();
  };

  if (collapsed) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          title={user.firstName || "User"}
          className="flex w-full items-center justify-center rounded-lg px-2 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
        >
          {user.imageUrl ? (
            <img
              src={user.imageUrl}
              alt={user.firstName || "User"}
              className="h-6 w-6 rounded-full"
            />
          ) : (
            <User className="h-4 w-4" />
          )}
        </button>
        {showMenu && (
          <div className="absolute bottom-full left-0 mb-2 w-32 rounded-md border border-border bg-background shadow-lg">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/30 transition-colors"
      >
        {user.imageUrl ? (
          <img
            src={user.imageUrl}
            alt={user.firstName || "User"}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="truncate text-sm font-medium text-foreground">
            {user.firstName || user.emailAddresses[0]?.emailAddress || "User"}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <RoleIcon className="h-3 w-3" />
            {roleLabel}
          </div>
        </div>
      </button>
      {showMenu && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border border-border bg-background shadow-lg">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/30 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ collapsed }: UserMenuProps) {
  const { mode, role } = useAuth();

  if (mode !== "clerk") {
    return null;
  }

  return <ClerkUserMenu collapsed={collapsed} role={role} />;
}

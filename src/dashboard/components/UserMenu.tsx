// ABOUTME: User menu component showing avatar, role badge, and sign out.
// ABOUTME: Only displayed when Clerk authentication is enabled.

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

  if (!isLoaded || !user) {
    return null;
  }

  const RoleIcon = roleIcons[role];
  const roleLabel = roleLabels[role];

  const handleSignOut = () => {
    signOut();
  };

  if (collapsed) {
    // When collapsed, just show avatar
    return (
      <div className="flex justify-center">
        {user.imageUrl ? (
          <img
            src={user.imageUrl}
            alt={user.firstName || "User"}
            className="h-8 w-8 rounded-full"
            title={user.firstName || "User"}
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Sign out button above user info */}
      <button
        onClick={handleSignOut}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        )}
      >
        <LogOut className="h-4 w-4 shrink-0" />
        Sign out
      </button>

      {/* User info */}
      <div className="flex items-center gap-3 px-3 py-2">
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
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {user.firstName || user.emailAddresses[0]?.emailAddress || "User"}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <RoleIcon className="h-3 w-3" />
            {roleLabel}
          </div>
        </div>
      </div>
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

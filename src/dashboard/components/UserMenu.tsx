// ABOUTME: User menu component showing avatar, role badge, and sign out.
// ABOUTME: Only displayed when Better Auth authentication is enabled.

import { LogOut, User, Shield, Eye, Wrench } from "lucide-react";
import { useAuth, type UserRole } from "./AuthProvider";
import { authClient } from "../lib/auth-client";
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

function UserInfo({ collapsed, role }: { collapsed: boolean; role: UserRole }) {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  const RoleIcon = roleIcons[role];
  const roleLabel = roleLabels[role];

  if (collapsed) {
    return (
      <div className="flex justify-center">
        {user.image ? (
          <img
            src={user.image}
            alt={user.name || "User"}
            className="h-8 w-8 rounded-full"
            title={user.name || "User"}
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
    <div className="flex items-center gap-3 px-3 py-2">
      {user.image ? (
        <img
          src={user.image}
          alt={user.name || "User"}
          className="h-8 w-8 rounded-full"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {user.name || user.email || "User"}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <RoleIcon className="h-3 w-3" />
          {roleLabel}
        </div>
      </div>
    </div>
  );
}

function SignOutButtonInner({ collapsed }: { collapsed: boolean }) {
  function handleSignOut() {
    authClient.signOut();
  }

  return (
    <button
      onClick={handleSignOut}
      title="Sign out"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
        collapsed && "justify-center px-2"
      )}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      {!collapsed && "Sign out"}
    </button>
  );
}

export function UserMenu({ collapsed }: UserMenuProps) {
  const { mode, role } = useAuth();

  if (mode !== "betterauth") {
    return null;
  }

  return <UserInfo collapsed={collapsed} role={role} />;
}

export function SignOutButton({ collapsed }: { collapsed: boolean }) {
  const { mode } = useAuth();

  if (mode !== "betterauth") {
    return null;
  }

  return <SignOutButtonInner collapsed={collapsed} />;
}

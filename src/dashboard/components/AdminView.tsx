// ABOUTME: Tabbed admin view for managing hub entities (users, machines, projects).
// ABOUTME: Rendered inline in the dashboard main content area.

import { useState } from "react";
import { RealmsTab } from "./RealmsTab";
import { UsersTab } from "./UsersTab";
import { MachinesTab } from "./MachinesTab";
import { ProjectsTab } from "./ProjectsTab";

const TABS = [
  { id: "realms", label: "Realms" },
  { id: "users", label: "Users" },
  { id: "machines", label: "Machines" },
  { id: "projects", label: "Projects" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminView() {
  const [activeTab, setActiveTab] = useState<TabId>("realms");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">
          Manage realms, users, machines, and projects
        </p>
      </div>

      <div className="flex gap-4 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-sm font-medium pb-3 border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "realms" && <RealmsTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "machines" && <MachinesTab />}
      {activeTab === "projects" && <ProjectsTab />}
    </div>
  );
}

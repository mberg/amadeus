// ABOUTME: Tabbed admin panel for managing hub entities.
// ABOUTME: Provides Users, Machines, and Projects tabs with CRUD operations.

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { UsersTab } from "./UsersTab";
import { MachinesTab } from "./MachinesTab";
import { ProjectsTab } from "./ProjectsTab";

const TABS = [
  { id: "users", label: "Users" },
  { id: "machines", label: "Machines" },
  { id: "projects", label: "Projects" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("users");

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center gap-6 h-14">
            <a
              href="/dashboard"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors mr-2"
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </a>
            <h1 className="text-lg font-semibold tracking-tight mr-4">Admin</h1>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`text-sm font-medium py-4 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {activeTab === "users" && <UsersTab />}
        {activeTab === "machines" && <MachinesTab />}
        {activeTab === "projects" && <ProjectsTab />}
      </div>
    </div>
  );
}

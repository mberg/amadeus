// ABOUTME: Setup panel displaying configured realms and projects.
// ABOUTME: Shows read-only view of amadeus.config.yaml configuration.

import { useState } from "react";
import { ChevronDown, ChevronRight, Settings, Globe, FolderGit2, ExternalLink } from "lucide-react";
import { Badge } from "./ui/badge";
import type { SetupData } from "../types";

interface SetupPanelProps {
  setup: SetupData | null | undefined;
}

export function SetupPanel({ setup }: SetupPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!setup) {
    return null;
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <Settings className="h-4 w-4" />
        <span>Configuration</span>
        <Badge variant="default" className="ml-2">
          {setup.realms.length} realm{setup.realms.length !== 1 ? "s" : ""}
        </Badge>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Global Settings */}
          <div className="rounded-md border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium text-foreground">Global Settings</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent Name</span>
                <span className="font-mono text-foreground">{setup.global.agentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Port</span>
                <span className="font-mono text-foreground">{setup.global.port}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Worktrees</span>
                <span className="font-mono text-foreground">{setup.global.useWorktrees ? "Enabled" : "Disabled"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Default Profile</span>
                <span className="font-mono text-foreground">{setup.global.defaultProfile}</span>
              </div>
              <div className="col-span-2 flex justify-between md:col-span-1">
                <span className="text-muted-foreground">Trigger States</span>
                <span className="font-mono text-foreground">{setup.global.triggerStates.join(", ")}</span>
              </div>
            </div>
          </div>

          {/* Realms */}
          {setup.realms.map((realm) => (
            <div key={realm.name} className="rounded-md border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">{realm.name}</h3>
                <Badge variant="outline" className="ml-auto">
                  {realm.linearWorkspace}
                </Badge>
              </div>

              <div className="space-y-2">
                {realm.projects.map((project, idx) => (
                  <div
                    key={`${project.teamKey}-${idx}`}
                    className="flex items-start gap-3 rounded border border-border/50 bg-background p-3 text-sm"
                  >
                    <FolderGit2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {project.linearProject || project.teamKey}
                        </span>
                        {project.linearProject && (
                          <Badge variant="default" className="text-xs">
                            {project.teamKey}
                          </Badge>
                        )}
                        {project.profile && project.profile !== setup.global.defaultProfile && (
                          <Badge variant="outline" className="text-xs">
                            {project.profile}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {project.path}
                      </div>
                      {project.githubRepoUrl && (
                        <a
                          href={project.githubRepoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                          GitHub
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ABOUTME: Setup panel displaying configured realms and projects.
// ABOUTME: Shows read-only view of amadeus.config.yaml configuration.

import { Globe, FolderGit2, Github } from "lucide-react";
import { Badge } from "./ui/badge";
import type { SetupData, SetupProject } from "../types";

function extractGitHubRepo(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  return match[1].replace(/\.git$/, "");
}

function sortProjects(projects: SetupProject[]): SetupProject[] {
  return [...projects].sort((a, b) => {
    const nameA = (a.linearProject || a.teamKey).toLowerCase();
    const nameB = (b.linearProject || b.teamKey).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

interface SetupPanelProps {
  setup: SetupData | null | undefined;
}

export function SetupPanel({ setup }: SetupPanelProps) {
  if (!setup) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No configuration loaded</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Global Settings */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-medium text-foreground">Global Settings</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-3">
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
      <div>
        <h3 className="mb-4 text-sm font-medium text-foreground">
          Realms
          <Badge variant="default" className="ml-2">
            {setup.realms.length}
          </Badge>
        </h3>
        <div className="space-y-4">
          {setup.realms.map((realm) => (
            <div key={realm.name} className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{realm.name}</span>
                <Badge variant="outline" className="ml-auto">
                  {realm.linearWorkspace}
                </Badge>
              </div>

              <div className="space-y-3">
                {sortProjects(realm.projects).map((project, idx) => (
                  <div
                    key={`${project.teamKey}-${idx}`}
                    className="flex items-start gap-3 rounded-md border border-border/50 bg-background p-4 text-sm"
                  >
                    <FolderGit2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {project.linearProject ? (
                          <a
                            href={`https://linear.app/${realm.linearWorkspace}/team/${project.teamKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 100 100" fill="currentColor">
                              <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5765C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3072.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5765-1.49115-.2863-1.64812.4782-.46593 2.2686-.77832 4.5932-.92593968 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7946 3.5171-1.6985 5.1853-2.7044.6246-.3767.7028-1.2445.1409-1.8063L8.71679 24.3801c-.56191-.5765-1.42964-.4837-1.80634.1408-1.00596 1.6683-1.90987 3.3993-2.70452 5.1845ZM12.6587 18.074c-.3701.3701-.393.9637-.0443 1.3541L74.5765 87.3738c.3903.348.984.3258 1.3537-.0439 1.6231-1.6231 3.1556-3.3355 4.5907-5.1282.4631-.5783.3934-1.4216-.1552-1.9075L15.1509 15.0797c-.5765-.5765-1.3293-.6184-1.9076-.1553-1.7926 1.4351-3.5044 2.9676-5.1282 4.5765l-.456.5765.0013-.0026ZM25.3325 7.62309c-.4883.42723-.5765 1.15718-.1619 1.6579l64.3845 73.7868c.4146.4885 1.1446.5765 1.6579.1619 1.3455-1.1101 2.6318-2.2941 3.8522-3.544.4808-.4923.4682-1.2713-.024-1.7505L30.6262 13.515c-.4923-.4923-1.2582-.5046-1.7505-.0239-1.2499 1.2204-2.4339 2.5765-3.5432 3.8522v.2798ZM40.6802 2.12018c-.5765.50386-.6907 1.32147-.232 1.93628l55.9522 64.1145c.5765.6908 1.4326.6051 1.9365.2321 1.1022-.8168 2.1613-1.6919 3.1721-2.6189.5766-.5765.5415-1.4577-.0457-2.0449L36.1451 1.36526c-.5765-.5765-1.4691-.62417-2.0448-.04506-.9271 1.01077-1.8021 2.06986-2.6189 3.17195l-.8012-.3717ZM58.8238.14438c-.6526.42542-.7652 1.3008-.2296 1.90734l44.1279 50.05568c.5765.6065 1.4834.5765 1.9073-.2296.2875-.5765.5616-1.1024.8219-1.6844.3216-.7185.0832-1.5575-.5765-2.0073L57.0732.245746C56.7523.073418 56.3803-.011729 56.0075.00161c-.5765.039475-1.1375.206935-1.6581.422334l-1.5256-.278564ZM79.3787.00161c-1.0249.060654-1.5965.964156-1.2269 1.926204l31.5324 48.25418c.5765.9765 1.4575.9765 1.9327.2296l.2296-.5765c-.0159-.6866-.0848-1.3626-.2029-2.0193-.1181-.6568-.2859-1.2969-.5004-1.9133L82.0261 1.14355c-.5765-.74554-1.4475-1.16983-2.3603-1.14194h-.2871Z" />
                            </svg>
                            {project.linearProject}
                          </a>
                        ) : (
                          <span className="font-medium text-foreground">
                            {project.teamKey}
                          </span>
                        )}
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
                          <Github className="h-3 w-3" />
                          {extractGitHubRepo(project.githubRepoUrl) || "GitHub"}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

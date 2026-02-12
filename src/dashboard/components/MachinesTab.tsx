// ABOUTME: Admin tab for managing machines with list, add, delete, and linked project details.
// ABOUTME: Machine creation generates an API key shown once. Uses /cloud/admin/machines and /hub/api endpoints.

import { useState, useEffect, useCallback, Fragment, useRef } from "react";
import { Trash2, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";

interface Machine {
  id: string;
  name: string;
  url: string;
  lastSeen: string | null;
}

interface MachineProjectLink {
  machineId: string;
  projectId: string;
  localRepoPath: string;
}

interface Project {
  id: string;
  name: string;
}

export function MachinesTab() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ machineId: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [machineProjects, setMachineProjects] = useState<Record<string, MachineProjectLink[]>>({});

  const fetchMachines = useCallback(async () => {
    try {
      const [machinesRes, projectsRes] = await Promise.all([
        fetch("/hub/api/machines"),
        fetch("/hub/api/projects"),
      ]);
      if (machinesRes.ok) setMachines(await machinesRes.json());
      if (projectsRes.ok) setProjects(await projectsRes.json());
    } catch (err) {
      console.error("Failed to fetch machines:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMachines();
  }, [fetchMachines]);

  async function fetchMachineProjects(machineId: string) {
    try {
      const res = await fetch(`/hub/api/machines/${machineId}/projects`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const projects = await res.json();
      setMachineProjects((prev) => ({ ...prev, [machineId]: projects }));
    } catch (err) {
      console.error("Failed to fetch machine projects:", err);
    }
  }

  function handleToggleExpand(machineId: string) {
    if (expandedId === machineId) {
      setExpandedId(null);
    } else {
      setExpandedId(machineId);
      if (!machineProjects[machineId]) {
        fetchMachineProjects(machineId);
      }
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/cloud/admin/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setCreatedKey(data);
      setName("");
      setUrl("");
      await fetchMachines();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add machine");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(machineId: string) {
    try {
      const res = await fetch(`/cloud/admin/machines/${machineId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchMachines();
    } catch (err) {
      console.error("Failed to delete machine:", err);
    }
  }

  function handleCopy() {
    if (createdKey?.apiKey) {
      navigator.clipboard.writeText(createdKey.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const projectNameMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  if (loading) {
    return <div className="text-muted-foreground">Loading machines...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Add machine form */}
      <form onSubmit={handleAdd} className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h3 className="text-sm font-medium">Add Machine</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="machineName" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              id="machineName"
              type="text"
              placeholder="production-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="machineUrl" className="text-xs font-medium text-muted-foreground">
              URL
            </label>
            <input
              id="machineUrl"
              type="url"
              placeholder="https://machine.example.com:8080"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating..." : "Add Machine"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </form>

      {/* API key display after creation */}
      {createdKey && (
        <div className="p-3 rounded-md border border-border bg-card space-y-2">
          <p className="text-sm font-medium">Machine created</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-input bg-muted/50 px-3 py-1.5 text-sm font-mono break-all">
              {createdKey.apiKey}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 inline-flex items-center justify-center rounded-md border border-input bg-background p-1.5 hover:bg-muted/50 transition-colors"
              title="Copy API key"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-xs text-destructive">
            This key is shown only once. Copy it now.
          </p>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Machines table */}
      {machines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No machines yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium w-8"></th>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">URL</th>
              <th className="pb-2 font-medium">Last Seen</th>
              <th className="pb-2 font-medium w-16">Actions</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((machine) => (
              <Fragment key={machine.id}>
                <tr className="border-b border-border/50">
                  <td className="py-2.5">
                    <button
                      onClick={() => handleToggleExpand(machine.id)}
                      className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
                    >
                      {expandedId === machine.id ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </td>
                  <td className="py-2.5">{machine.name}</td>
                  <td className="py-2.5 text-muted-foreground font-mono text-xs">{machine.url}</td>
                  <td className="py-2.5 text-muted-foreground text-xs">
                    {machine.lastSeen
                      ? new Date(machine.lastSeen).toLocaleString()
                      : "never"}
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => handleDelete(machine.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete machine"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {expandedId === machine.id && (
                  <tr className="border-b border-border/50">
                    <td colSpan={5} className="py-2 pl-9">
                      <MachineProjectsList
                        projectLinks={machineProjects[machine.id]}
                        projectNames={projectNameMap}
                        machineId={machine.id}
                        onPathSaved={() => fetchMachineProjects(machine.id)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MachineProjectsList({
  projectLinks,
  projectNames,
  machineId,
  onPathSaved,
}: {
  projectLinks?: MachineProjectLink[];
  projectNames: Record<string, string>;
  machineId: string;
  onPathSaved: () => void;
}) {
  if (!projectLinks) {
    return <span className="text-xs text-muted-foreground">Loading projects...</span>;
  }
  if (projectLinks.length === 0) {
    return <span className="text-xs text-muted-foreground">No linked projects.</span>;
  }
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">Linked Projects</span>
      {projectLinks.map((p) => (
        <MachineProjectRow
          key={p.projectId}
          link={p}
          projectName={projectNames[p.projectId] ?? p.projectId}
          machineId={machineId}
          onSaved={onPathSaved}
        />
      ))}
    </div>
  );
}

function MachineProjectRow({
  link,
  projectName,
  machineId,
  onSaved,
}: {
  link: MachineProjectLink;
  projectName: string;
  machineId: string;
  onSaved: () => void;
}) {
  const [path, setPath] = useState(link.localRepoPath);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirty = path !== link.localRepoPath;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/hub/api/machines/${machineId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: link.projectId, localRepoPath: path }),
      });
      if (res.ok) onSaved();
    } catch (err) {
      console.error("Failed to save path:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="text-xs flex items-center gap-3">
      <span className="shrink-0 w-32">{projectName}</span>
      <input
        ref={inputRef}
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/path/to/repo"
        onKeyDown={(e) => { if (e.key === "Enter" && dirty) handleSave(); }}
        className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "..." : "Save"}
        </button>
      )}
    </div>
  );
}

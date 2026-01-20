// ABOUTME: Displays all registered machines and their agent counts.
// ABOUTME: Used in hub mode for aggregate visibility.

import { useState, useEffect } from "react";

interface MachineStatus {
  name: string;
  url: string;
  status: "healthy" | "unhealthy" | "unknown";
  agentCount: number;
  agents: Array<{
    key: string;
    issueIdentifier: string;
    issueTitle: string;
    linearState?: string;
  }>;
}

interface HubStatus {
  machines: MachineStatus[];
  timestamp: string;
}

export function MachinesView() {
  const [hubStatus, setHubStatus] = useState<HubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/hub/status");
        if (res.ok) {
          const data = await res.json();
          setHubStatus(data);
          setError(null);
        } else if (res.status === 404) {
          setError("Hub view not available in this mode");
        } else {
          setError(`Failed to fetch status: ${res.status}`);
        }
      } catch (err) {
        setError("Failed to connect to server");
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="p-8">Loading machines...</div>;
  }

  if (error) {
    return <div className="p-8 text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Machines</h1>
        <p className="text-muted-foreground">
          Overview of all registered machines
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hubStatus?.machines.map((machine) => (
          <div
            key={machine.name}
            className="rounded-lg border bg-card p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{machine.name}</h3>
              <span
                className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                  machine.status === "healthy"
                    ? "bg-green-100 text-green-800"
                    : machine.status === "unhealthy"
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {machine.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {machine.agentCount} agent{machine.agentCount !== 1 ? "s" : ""} running
            </p>
            <a
              href={`${machine.url}/dashboard`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm text-blue-600 hover:underline"
            >
              Open Dashboard →
            </a>
          </div>
        ))}
      </div>

      {hubStatus && (
        <div className="text-xs text-muted-foreground">
          Last updated {new Date(hubStatus.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

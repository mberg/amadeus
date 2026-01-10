// ABOUTME: Dashboard client-side logic for agent display and message console.
// ABOUTME: Handles status polling, agent card rendering, and message panel.

import "./dashboard.css";

interface DashboardConfig {
  linearWorkspace?: string;
}

let config: DashboardConfig = {};

interface Agent {
  key: string;
  port: number;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  linearState?: string;
  status: string;
  uptime: number;
  worktreePath?: string;
}

interface Message {
  role: string;
  content: string;
}

let currentAgentKey: string | null = null;
let messagesInterval: ReturnType<typeof setInterval> | null = null;
let agentsData: Agent[] = [];

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function getLinearUrl(identifier: string): string | null {
  if (!config.linearWorkspace) return null;
  return `https://linear.app/${config.linearWorkspace}/issue/${identifier}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getLinearStateClass(state: string | undefined): string {
  if (!state) return "";
  const lower = state.toLowerCase();
  if (lower.includes("scoping") || lower.includes("planning")) return "linear-state-scoping";
  if (lower.includes("building")) return "linear-state-building";
  if (lower.includes("feedback")) return "linear-state-feedback";
  if (lower.includes("review")) return "linear-state-review";
  if (lower.includes("done")) return "linear-state-done";
  return "";
}

function renderAgents(agents: Agent[]): void {
  agentsData = agents;
  const grid = document.getElementById("agents-grid")!;
  const totalEl = document.getElementById("total-agents")!;
  const workingEl = document.getElementById("working-agents")!;
  const idleEl = document.getElementById("idle-agents")!;

  totalEl.textContent = String(agents.length);
  workingEl.textContent = String(agents.filter((a) => a.status === "working").length);
  idleEl.textContent = String(agents.filter((a) => a.status === "idle").length);

  if (agents.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">🎼</div>
        <h2>No active agents</h2>
        <p>Agents will appear here when Linear issues trigger them</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = agents
    .map((agent) => {
      const linearUrl = getLinearUrl(agent.issueIdentifier);
      const linearLinkHtml = linearUrl
        ? `<a href="${linearUrl}" class="linear-link" target="_blank" rel="noopener" onclick="event.stopPropagation()">↗ Linear</a>`
        : "";

      return `
        <div class="agent-card clickable" data-agent-key="${escapeHtml(agent.key)}" onclick="openConsole('${escapeHtml(agent.key)}')">
          <div class="agent-header">
            <div class="agent-identifier">
              <div class="agent-identifier-row">
                <span class="agent-identifier-link">${escapeHtml(agent.issueIdentifier)}</span>
                ${agent.linearState ? `<span class="linear-state-badge ${getLinearStateClass(agent.linearState)}">${escapeHtml(agent.linearState)}</span>` : ""}
              </div>
              <div class="agent-title">${escapeHtml(agent.issueTitle)}</div>
              ${linearLinkHtml}
            </div>
            <div class="status-badge status-${agent.status}">
              <span class="dot"></span>
              ${agent.status}
            </div>
          </div>
          <div class="agent-details">
            <div class="detail">
              <div class="detail-label">Port</div>
              <div class="detail-value">${agent.port}</div>
            </div>
            <div class="detail">
              <div class="detail-label">Uptime</div>
              <div class="detail-value">${formatUptime(agent.uptime)}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function fetchStatus(): Promise<void> {
  try {
    const response = await fetch("/status");
    const data = await response.json();
    renderAgents(data.agents);
    document.getElementById("last-updated")!.textContent = new Date(data.timestamp).toLocaleTimeString();
  } catch (error) {
    console.error("Failed to fetch status:", error);
  }
}

function renderMessages(messages: Message[]): void {
  const body = document.getElementById("console-body")!;

  if (!messages || messages.length === 0) {
    body.innerHTML = '<div class="console-empty">No messages yet</div>';
    return;
  }

  body.innerHTML = messages
    .map((msg) => {
      const role = msg.role || "unknown";
      const content = msg.content || "";
      return `
        <div class="message message-${role}">
          <div class="message-role">${role}</div>
          <div class="message-content">${escapeHtml(content)}</div>
        </div>
      `;
    })
    .join("");

  body.scrollTop = body.scrollHeight;
}

async function fetchMessages(agentKey: string): Promise<void> {
  const body = document.getElementById("console-body")!;

  try {
    const response = await fetch(`/agents/${encodeURIComponent(agentKey)}/messages`);
    if (!response.ok) {
      if (response.status === 404) {
        body.innerHTML = '<div class="console-error">Agent not found</div>';
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    renderMessages(data.messages || []);
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    body.innerHTML = '<div class="console-error">Failed to load messages</div>';
  }
}

function openConsole(agentKey: string): void {
  const agent = agentsData.find((a) => a.key === agentKey);
  if (!agent) return;

  currentAgentKey = agentKey;

  document.getElementById("console-agent-id")!.textContent = `${agent.issueIdentifier} - ${agent.issueTitle}`;
  document.getElementById("console-body")!.innerHTML = '<div class="console-loading">Loading messages...</div>';
  document.getElementById("console-panel")!.classList.add("open");
  document.getElementById("console-overlay")!.classList.add("open");

  fetchMessages(agentKey);

  if (messagesInterval) clearInterval(messagesInterval);
  messagesInterval = setInterval(() => fetchMessages(agentKey), 1500);
}

function closeConsole(): void {
  currentAgentKey = null;

  if (messagesInterval) {
    clearInterval(messagesInterval);
    messagesInterval = null;
  }

  document.getElementById("console-panel")!.classList.remove("open");
  document.getElementById("console-overlay")!.classList.remove("open");
}

// Expose openConsole to global scope for onclick handlers
(window as unknown as { openConsole: typeof openConsole }).openConsole = openConsole;

// Event listeners
document.getElementById("console-close")!.addEventListener("click", closeConsole);
document.getElementById("console-overlay")!.addEventListener("click", closeConsole);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentAgentKey) {
    closeConsole();
  }
});

async function fetchConfig(): Promise<void> {
  try {
    const response = await fetch("/config");
    config = await response.json();
  } catch (error) {
    console.error("Failed to fetch config:", error);
  }
}

async function init(): Promise<void> {
  await fetchConfig();
  await fetchStatus();
  setInterval(fetchStatus, 2000);
}

init();

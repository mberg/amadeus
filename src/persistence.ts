// ABOUTME: SQLite persistence layer for agent lifecycle state and completed task history.
// ABOUTME: Tracks alive/dead status for agent recovery after crashes.

import { Database } from "bun:sqlite";

export interface PersistedAgentState {
  key: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  projectPath: string;
  worktreePath?: string;
  linearState?: string;
  port: number;
  status: "alive" | "dead" | "restarting";
  lastHeartbeat: Date;
}

export type CompletionReason = "done" | "stopped" | "canceled" | "backlog";

export interface PersistedCompletedTask {
  key: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  completedAt: Date;
  completionReason: CompletionReason;
  finalLinearState?: string;
  duration: number;
}

export class AgentPersistence {
  private db: Database;

  constructor(dbPath: string = "amadeus-agents.db") {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        issue_id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        issue_identifier TEXT NOT NULL,
        issue_title TEXT NOT NULL,
        project_path TEXT NOT NULL,
        worktree_path TEXT,
        linear_state TEXT,
        port INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'alive',
        last_heartbeat TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS completed_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        issue_identifier TEXT NOT NULL,
        issue_title TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        completion_reason TEXT NOT NULL,
        final_linear_state TEXT,
        duration INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_completed_tasks_completed_at
      ON completed_tasks (completed_at DESC)
    `);
  }

  saveAgentState(state: PersistedAgentState): void {
    this.db.run(
      `
      INSERT INTO agents (
        issue_id, key, issue_identifier, issue_title, project_path,
        worktree_path, linear_state, port, status, last_heartbeat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        key = excluded.key,
        issue_identifier = excluded.issue_identifier,
        issue_title = excluded.issue_title,
        project_path = excluded.project_path,
        worktree_path = excluded.worktree_path,
        linear_state = excluded.linear_state,
        port = excluded.port,
        status = excluded.status,
        last_heartbeat = excluded.last_heartbeat,
        updated_at = datetime('now')
      `,
      [
        state.issueId,
        state.key,
        state.issueIdentifier,
        state.issueTitle,
        state.projectPath,
        state.worktreePath ?? null,
        state.linearState ?? null,
        state.port,
        state.status,
        state.lastHeartbeat.toISOString(),
      ]
    );
  }

  getAgentByIssueId(issueId: string): PersistedAgentState | null {
    const row = this.db
      .query(`SELECT * FROM agents WHERE issue_id = ?`)
      .get(issueId) as Record<string, unknown> | null;

    if (!row) return null;

    return this.rowToState(row);
  }

  markAgentDead(issueId: string): void {
    this.db.run(
      `UPDATE agents SET status = 'dead', updated_at = datetime('now') WHERE issue_id = ?`,
      [issueId]
    );
  }

  markAgentAlive(issueId: string): void {
    this.db.run(
      `UPDATE agents SET status = 'alive', updated_at = datetime('now') WHERE issue_id = ?`,
      [issueId]
    );
  }

  getDeadAgents(): PersistedAgentState[] {
    const rows = this.db
      .query(`SELECT * FROM agents WHERE status = 'dead'`)
      .all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToState(row));
  }

  getAllAgents(): PersistedAgentState[] {
    const rows = this.db
      .query(`SELECT * FROM agents`)
      .all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToState(row));
  }

  deleteAgent(issueId: string): void {
    this.db.run(`DELETE FROM agents WHERE issue_id = ?`, [issueId]);
  }

  saveCompletedTask(task: PersistedCompletedTask): void {
    this.db.run(
      `
      INSERT INTO completed_tasks (
        key, issue_id, issue_identifier, issue_title,
        completed_at, completion_reason, final_linear_state, duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        task.key,
        task.issueId,
        task.issueIdentifier,
        task.issueTitle,
        task.completedAt.toISOString(),
        task.completionReason,
        task.finalLinearState ?? null,
        task.duration,
      ]
    );
  }

  getCompletedTasks(limit: number = 20, offset: number = 0): PersistedCompletedTask[] {
    const rows = this.db
      .query(
        `SELECT * FROM completed_tasks ORDER BY completed_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Record<string, unknown>[];

    return rows.map((row) => this.rowToCompletedTask(row));
  }

  getCompletedTasksCount(): number {
    const result = this.db
      .query(`SELECT COUNT(*) as count FROM completed_tasks`)
      .get() as { count: number };
    return result.count;
  }

  private rowToCompletedTask(row: Record<string, unknown>): PersistedCompletedTask {
    return {
      key: row.key as string,
      issueId: row.issue_id as string,
      issueIdentifier: row.issue_identifier as string,
      issueTitle: row.issue_title as string,
      completedAt: new Date(row.completed_at as string),
      completionReason: row.completion_reason as CompletionReason,
      finalLinearState: (row.final_linear_state as string | null) ?? undefined,
      duration: row.duration as number,
    };
  }

  close(): void {
    this.db.close();
  }

  private rowToState(row: Record<string, unknown>): PersistedAgentState {
    return {
      key: row.key as string,
      issueId: row.issue_id as string,
      issueIdentifier: row.issue_identifier as string,
      issueTitle: row.issue_title as string,
      projectPath: row.project_path as string,
      worktreePath: row.worktree_path as string | undefined,
      linearState: row.linear_state as string | undefined,
      port: row.port as number,
      status: row.status as "alive" | "dead" | "restarting",
      lastHeartbeat: new Date(row.last_heartbeat as string),
    };
  }
}

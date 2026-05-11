import Database from 'better-sqlite3';
import { join } from 'path';
import type { Goal, SubTask, Worker, GoalStatus, SubTaskStatus, WorkerStatus, WorkerStats } from './types.js';

let db: Database.Database | null = null;

export function initDatabase(dataDir: string): Database.Database {
  const dbPath = join(dataDir, 'orchestrator.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  createTables();
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase first.');
  return db;
}

function createTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      work_dir TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'general',
      dependencies TEXT NOT NULL DEFAULT '[]',
      estimated_effort INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_worker_id TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      role TEXT NOT NULL,
      current_task_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      goal_id TEXT,
      start_time TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      stats TEXT NOT NULL DEFAULT '{}'
    );

    -- Event-driven log: only key events (not per-message)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      task_id TEXT,
      file_path TEXT,
      tool_name TEXT,
      summary TEXT,
      details TEXT,
      token_count INTEGER,
      timestamp TEXT NOT NULL
    );

    -- Legacy transcripts table kept for backward compatibility
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      error TEXT,
      thinking TEXT,
      usage_input_tokens INTEGER,
      usage_output_tokens INTEGER,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_subtasks_goal ON subtasks(goal_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
    CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
    CREATE INDEX IF NOT EXISTS idx_events_worker ON events(worker_id);
    CREATE INDEX IF NOT EXISTS idx_events_goal ON events(goal_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_transcripts_worker ON transcripts(worker_id);
  `);
}

// Goal CRUD
export function createGoal(goal: Goal): void {
  const stmt = getDb().prepare(`
    INSERT INTO goals (id, description, work_dir, priority, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(goal.id, goal.description, goal.workDir, goal.priority, goal.status, goal.createdAt, goal.updatedAt);
}

export function updateGoalStatus(id: string, status: GoalStatus): void {
  const completedAt = status === 'completed' || status === 'failed' || status === 'cancelled'
    ? new Date().toISOString()
    : null;
  const stmt = getDb().prepare(`
    UPDATE goals SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
  `);
  stmt.run(status, new Date().toISOString(), completedAt, id);
}

export function getGoal(id: string): Goal | undefined {
  const stmt = getDb().prepare('SELECT * FROM goals WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToGoal(row);
}

export function listGoals(): Goal[] {
  const stmt = getDb().prepare('SELECT * FROM goals ORDER BY created_at DESC');
  return (stmt.all() as Record<string, unknown>[]).map(rowToGoal);
}

// SubTask CRUD
export function createSubTask(subtask: SubTask): void {
  const stmt = getDb().prepare(`
    INSERT INTO subtasks (id, goal_id, title, description, role, dependencies, estimated_effort,
      status, assigned_worker_id, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    subtask.id, subtask.goalId, subtask.title, subtask.description, subtask.role,
    JSON.stringify(subtask.dependencies), subtask.estimatedEffort, subtask.status,
    subtask.assignedWorkerId ?? null, subtask.result ? JSON.stringify(subtask.result) : null,
    subtask.createdAt, subtask.updatedAt
  );
}

export function updateSubTaskStatus(id: string, status: SubTaskStatus, updates?: Partial<SubTask>): void {
  const fields: string[] = ['status = ?', 'updated_at = ?'];
  const values: unknown[] = [status, new Date().toISOString()];

  if (updates?.assignedWorkerId !== undefined) {
    fields.push('assigned_worker_id = ?');
    values.push(updates.assignedWorkerId);
  }
  if (updates?.result !== undefined) {
    fields.push('result = ?');
    values.push(JSON.stringify(updates.result));
  }
  if (status === 'running' && !updates?.startedAt) {
    fields.push('started_at = ?');
    values.push(new Date().toISOString());
  }
  if (status === 'completed' || status === 'failed') {
    fields.push('completed_at = ?');
    values.push(new Date().toISOString());
  }

  values.push(id);
  const stmt = getDb().prepare(`UPDATE subtasks SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

export function getSubTasksByGoal(goalId: string): SubTask[] {
  const stmt = getDb().prepare('SELECT * FROM subtasks WHERE goal_id = ? ORDER BY created_at');
  return (stmt.all(goalId) as Record<string, unknown>[]).map(rowToSubTask);
}

export function getPendingSubTasks(): SubTask[] {
  const stmt = getDb().prepare(`
    SELECT * FROM subtasks WHERE status IN ('pending', 'queued')
    ORDER BY estimated_effort DESC, created_at ASC
  `);
  return (stmt.all() as Record<string, unknown>[]).map(rowToSubTask);
}

// Worker CRUD
export function createWorker(worker: Worker): void {
  const stmt = getDb().prepare(`
    INSERT INTO workers (id, pid, role, current_task_id, status, goal_id, start_time, last_activity, stats)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    worker.id, worker.pid, worker.role, worker.currentTaskId ?? null,
    worker.status, worker.goalId ?? null, worker.startTime, worker.lastActivity,
    JSON.stringify(worker.stats)
  );
}

export function updateWorkerStatus(id: string, status: WorkerStatus, updates?: Partial<Worker>): void {
  const fields: string[] = ['status = ?', 'last_activity = ?'];
  const values: unknown[] = [status, new Date().toISOString()];

  if (updates?.currentTaskId !== undefined) {
    fields.push('current_task_id = ?');
    values.push(updates.currentTaskId);
  }
  if (updates?.stats !== undefined) {
    fields.push('stats = ?');
    values.push(JSON.stringify(updates.stats));
  }

  values.push(id);
  const stmt = getDb().prepare(`UPDATE workers SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

export function getWorker(id: string): Worker | undefined {
  const stmt = getDb().prepare('SELECT * FROM workers WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToWorker(row);
}

export function listWorkers(): Worker[] {
  const stmt = getDb().prepare('SELECT * FROM workers ORDER BY start_time DESC');
  return (stmt.all() as Record<string, unknown>[]).map(rowToWorker);
}

export function listActiveWorkers(): Worker[] {
  const stmt = getDb().prepare("SELECT * FROM workers WHERE status IN ('idle', 'working', 'paused')");
  return (stmt.all() as Record<string, unknown>[]).map(rowToWorker);
}

export function deleteWorker(id: string): void {
  const stmt = getDb().prepare('DELETE FROM workers WHERE id = ?');
  stmt.run(id);
}

// Event-driven logging: only key events (not per-message)
export function logEvent(event: {
  worker_id: string;
  goal_id: string;
  event_type: string;
  task_id?: string;
  file_path?: string;
  tool_name?: string;
  summary?: string;
  details?: Record<string, unknown>;
  token_count?: number;
}): void {
  const stmt = getDb().prepare(`
    INSERT INTO events (worker_id, goal_id, event_type, task_id, file_path, tool_name,
      summary, details, token_count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    event.worker_id,
    event.goal_id,
    event.event_type,
    event.task_id ?? null,
    event.file_path ?? null,
    event.tool_name ?? null,
    event.summary ?? null,
    event.details ? JSON.stringify(event.details) : null,
    event.token_count ?? null,
    new Date().toISOString()
  );
}

// Legacy transcript logging — kept for backward compatibility but no longer used
export function logTranscriptMessage(workerId: string, goalId: string, message: {
  type: string;
  content?: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  error?: string;
  thinking?: string;
  usage_input_tokens?: number;
  usage_output_tokens?: number;
}): void {
  const stmt = getDb().prepare(`
    INSERT INTO transcripts (worker_id, goal_id, message_type, content, tool_name, tool_input,
      tool_output, error, thinking, usage_input_tokens, usage_output_tokens, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    workerId, goalId, message.type, message.content ?? null, message.tool_name ?? null,
    message.tool_input ?? null, message.tool_output ?? null, message.error ?? null,
    message.thinking ?? null, message.usage_input_tokens ?? null,
    message.usage_output_tokens ?? null, new Date().toISOString()
  );
}

// Row mappers
function rowToGoal(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    description: row.description as string,
    workDir: row.work_dir as string,
    priority: row.priority as Goal['priority'],
    status: row.status as GoalStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: row.completed_at as string | undefined,
  };
}

function rowToSubTask(row: Record<string, unknown>): SubTask {
  return {
    id: row.id as string,
    goalId: row.goal_id as string,
    title: row.title as string,
    description: row.description as string,
    role: row.role as SubTask['role'],
    dependencies: JSON.parse(row.dependencies as string) as string[],
    estimatedEffort: row.estimated_effort as number,
    status: row.status as SubTaskStatus,
    assignedWorkerId: row.assigned_worker_id as string | undefined,
    result: row.result ? JSON.parse(row.result as string) as SubTask['result'] : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    startedAt: row.started_at as string | undefined,
    completedAt: row.completed_at as string | undefined,
  };
}

function rowToWorker(row: Record<string, unknown>): Worker {
  return {
    id: row.id as string,
    pid: row.pid as number,
    role: row.role as Worker['role'],
    currentTaskId: row.current_task_id as string | undefined,
    status: row.status as WorkerStatus,
    goalId: row.goal_id as string | undefined,
    startTime: row.start_time as string,
    lastActivity: row.last_activity as string,
    stats: JSON.parse(row.stats as string) as WorkerStats,
  };
}

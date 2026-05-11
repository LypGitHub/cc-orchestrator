import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initDatabase, getDb, createGoal, getGoal, listGoals, updateGoalStatus,
  createSubTask, getSubTasksByGoal, updateSubTaskStatus,
  createWorker, getWorker, listWorkers, updateWorkerStatus, deleteWorker,
  logTranscriptMessage,
} from '../src/db.js';

describe('Database', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-orch-db-'));
    initDatabase(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates and retrieves a goal', () => {
    const goal = {
      id: 'goal_001', description: 'Test', workDir: '/tmp', priority: 'high' as const,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    createGoal(goal);
    const retrieved = getGoal('goal_001');
    expect(retrieved).toBeDefined();
    expect(retrieved?.description).toBe('Test');
    expect(retrieved?.priority).toBe('high');
  });

  it('updates goal status', () => {
    const goal = {
      id: 'goal_002', description: 'Test', workDir: '/tmp', priority: 'medium' as const,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    createGoal(goal);
    updateGoalStatus('goal_002', 'running');
    const retrieved = getGoal('goal_002');
    expect(retrieved?.status).toBe('running');
  });

  it('lists goals in descending order', () => {
    createGoal({ id: 'g1', description: 'A', workDir: '/tmp', priority: 'low', status: 'pending', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' });
    createGoal({ id: 'g2', description: 'B', workDir: '/tmp', priority: 'low', status: 'pending', createdAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' });
    const goals = listGoals();
    expect(goals).toHaveLength(2);
    expect(goals[0].id).toBe('g2');
  });

  it('creates and retrieves subtasks', () => {
    createGoal({ id: 'goal_003', description: 'Test', workDir: '/tmp', priority: 'medium', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const subtask = {
      id: 'st_001', goalId: 'goal_003', title: 'Fix bug', description: 'Fix login bug',
      role: 'backend-engineer' as const, dependencies: [], estimatedEffort: 3,
      status: 'pending' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    createSubTask(subtask);
    const subtasks = getSubTasksByGoal('goal_003');
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].title).toBe('Fix bug');
    expect(subtasks[0].dependencies).toEqual([]);
  });

  it('updates subtask status', () => {
    createGoal({ id: 'goal_004', description: 'Test', workDir: '/tmp', priority: 'medium', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    createSubTask({ id: 'st_002', goalId: 'goal_004', title: 'T', description: 'D', role: 'general', dependencies: [], estimatedEffort: 1, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    updateSubTaskStatus('st_002', 'running', { assignedWorkerId: 'w_001' });
    const [st] = getSubTasksByGoal('goal_004');
    expect(st.status).toBe('running');
    expect(st.assignedWorkerId).toBe('w_001');
  });

  it('creates and manages workers', () => {
    const worker = {
      id: 'w_001', pid: 12345, role: 'backend-engineer' as const, status: 'idle' as const,
      startTime: new Date().toISOString(), lastActivity: new Date().toISOString(),
      stats: { turnsUsed: 0, toolsUsed: {}, filesModified: [], errors: 0, tokensInput: 0, tokensOutput: 0 },
    };
    createWorker(worker);
    const retrieved = getWorker('w_001');
    expect(retrieved).toBeDefined();
    expect(retrieved?.pid).toBe(12345);

    updateWorkerStatus('w_001', 'working', { currentTaskId: 'st_001' });
    const updated = getWorker('w_001');
    expect(updated?.status).toBe('working');
    expect(updated?.currentTaskId).toBe('st_001');

    deleteWorker('w_001');
    expect(getWorker('w_001')).toBeUndefined();
  });

  it('logs transcript messages', () => {
    logTranscriptMessage('w_001', 'goal_001', { type: 'assistant', content: 'Hello' });
    const db = getDb();
    const rows = db.prepare('SELECT * FROM transcripts WHERE worker_id = ?').all('w_001');
    expect(rows).toHaveLength(1);
  });
});

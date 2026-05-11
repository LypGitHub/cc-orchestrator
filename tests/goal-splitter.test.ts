import { describe, it, expect, beforeEach } from 'vitest';
import { GoalSplitter } from '../src/goal-splitter.js';
import type { Goal } from '../src/types.js';

describe('GoalSplitter', () => {
  let splitter: GoalSplitter;

  beforeEach(() => {
    splitter = new GoalSplitter();
  });

  it('splits a backend goal into subtasks', async () => {
    const goal: Goal = {
      id: 'goal_001', description: 'Create REST API with database schema and tests',
      workDir: '/tmp', priority: 'high', status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const subTasks = await splitter.split(goal);
    expect(subTasks.length).toBeGreaterThanOrEqual(2);
    const roles = subTasks.map(st => st.role);
    expect(roles).toContain('backend-engineer');
    expect(roles).toContain('qa-engineer');
  });

  it('creates single task for generic goal', async () => {
    const goal: Goal = {
      id: 'goal_002', description: 'Write some code',
      workDir: '/tmp', priority: 'medium', status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const subTasks = await splitter.split(goal);
    expect(subTasks).toHaveLength(1);
    expect(subTasks[0].role).toBe('general');
  });

  it('adds dependencies for review tasks', async () => {
    const goal: Goal = {
      id: 'goal_003', description: 'Build API and review the code',
      workDir: '/tmp', priority: 'high', status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const subTasks = await splitter.split(goal);
    const reviewTask = subTasks.find(st => st.role === 'code-reviewer');
    if (reviewTask) {
      expect(reviewTask.dependencies.length).toBeGreaterThan(0);
    }
  });

  it('each subtask has a unique ID', async () => {
    const goal: Goal = {
      id: 'goal_004', description: 'Create API and UI with tests',
      workDir: '/tmp', priority: 'medium', status: 'pending',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const subTasks = await splitter.split(goal);
    const ids = subTasks.map(st => st.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

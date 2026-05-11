import { describe, it, expect } from 'vitest';
import type { Goal, SubTask, Worker, StreamMessage } from '../src/types.js';

describe('Type exports', () => {
  it('Goal interface can be constructed', () => {
    const goal: Goal = {
      id: 'goal_001',
      description: 'Test goal',
      workDir: '/tmp',
      priority: 'high',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(goal.id).toBe('goal_001');
    expect(goal.priority).toBe('high');
  });

  it('SubTask interface supports all statuses', () => {
    const statuses: SubTask['status'][] = ['pending', 'queued', 'assigned', 'running', 'completed', 'failed'];
    expect(statuses).toHaveLength(6);
  });

  it('Worker interface has required fields', () => {
    const worker: Worker = {
      id: 'w_001',
      pid: 12345,
      role: 'backend-engineer',
      status: 'idle',
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      stats: {
        turnsUsed: 0,
        toolsUsed: {},
        filesModified: [],
        errors: 0,
        tokensInput: 0,
        tokensOutput: 0,
      },
    };
    expect(worker.status).toBe('idle');
  });

  it('StreamMessage supports all types', () => {
    const msg: StreamMessage = {
      type: 'assistant',
      content: 'Hello',
    };
    expect(msg.type).toBe('assistant');
  });
});

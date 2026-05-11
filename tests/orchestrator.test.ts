import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../src/orchestrator.js';
import { initDatabase } from '../src/db.js';
import type { OrchestratorConfig } from '../src/types.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Orchestrator', () => {
  let orch: Orchestrator;
  let tempDir: string;
  let config: OrchestratorConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-orch-orch-'));
    initDatabase(tempDir);
    config = {
      port: 17890, maxWorkers: 2, minWorkers: 0, dataDir: tempDir,
      cpuThresholdHigh: 80, cpuThresholdCritical: 90, monitorIntervalMs: 5000,
      defaultMaxTurns: 100, defaultModel: 'opus',
    };
    orch = new Orchestrator(config);
  });

  afterEach(async () => {
    await orch.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a goal and splits it', async () => {
    const goal = await orch.createGoal({
      description: 'Write some code',
      workDir: '/tmp',
      priority: 'medium',
    });
    expect(goal.id).toMatch(/^goal_/);
    expect(goal.status).toBe('pending');
    expect(goal.description).toBe('Write some code');
  });

  it('lists goals', async () => {
    await orch.createGoal({ description: 'Goal A', workDir: '/tmp' });
    await orch.createGoal({ description: 'Goal B', workDir: '/tmp' });
    const goals = orch.listGoals();
    expect(goals.length).toBe(2);
  });

  it('gets goal with subtasks', async () => {
    const goal = await orch.createGoal({ description: 'Create API and UI', workDir: '/tmp' });
    // Wait a tick for async split
    await new Promise(r => setTimeout(r, 100));
    const result = orch.getGoal(goal.id);
    expect(result).not.toBeNull();
    expect(result?.goal.id).toBe(goal.id);
    expect(result?.subTasks.length).toBeGreaterThan(0);
  });

  it('returns null for non-existent goal', () => {
    expect(orch.getGoal('nonexistent')).toBeNull();
  });

  it('lists workers', () => {
    const workers = orch.listWorkers();
    expect(Array.isArray(workers)).toBe(true);
  });

  it('returns system status', () => {
    const status = orch.getSystemStatus();
    expect(status.stats).toBeDefined();
    expect(status.workers).toBeDefined();
    expect(status.activeGoals).toBeDefined();
  });

  it('cancelGoal marks goal as cancelled', async () => {
    const goal = await orch.createGoal({ description: 'Test', workDir: '/tmp' });
    await orch.cancelGoal(goal.id);
    const result = orch.getGoal(goal.id);
    expect(result?.goal.status).toBe('cancelled');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceMonitor } from '../src/resource-monitor.js';
import type { OrchestratorConfig, SystemStats } from '../src/types.js';

describe('ResourceMonitor', () => {
  let monitor: ResourceMonitor;
  let config: OrchestratorConfig;

  beforeEach(() => {
    config = {
      port: 17890, maxWorkers: 4, minWorkers: 0, dataDir: '/tmp',
      cpuThresholdHigh: 80, cpuThresholdCritical: 90, monitorIntervalMs: 5000,
      defaultMaxTurns: 100, defaultModel: 'opus',
    };
    monitor = new ResourceMonitor(config);
  });

  it('samples system stats', async () => {
    const stats = await monitor.sample();
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpuPercent).toBeLessThanOrEqual(100);
    expect(stats.memoryPercent).toBeGreaterThanOrEqual(0);
    expect(stats.memoryPercent).toBeLessThanOrEqual(100);
    expect(stats.memoryTotalMB).toBeGreaterThan(0);
    expect(stats.loadAvg).toHaveLength(3);
  });

  it('decides SPAWN_WORKER when CPU low and tasks pending', () => {
    const stats: SystemStats = {
      cpuPercent: 30, memoryPercent: 50, memoryUsedMB: 4000, memoryTotalMB: 16000,
      loadAvg: [1, 1, 1], activeWorkers: 1, totalWorkers: 1, pendingTasks: 3,
    };
    const action = monitor.decideAction(stats, config);
    expect(action.type).toBe('SPAWN_WORKER');
    expect(action.reason).toContain('CPU at 30%');
  });

  it('decides NOOP when CPU high', () => {
    const stats: SystemStats = {
      cpuPercent: 85, memoryPercent: 50, memoryUsedMB: 4000, memoryTotalMB: 16000,
      loadAvg: [1, 1, 1], activeWorkers: 2, totalWorkers: 2, pendingTasks: 3,
    };
    const action = monitor.decideAction(stats, config);
    expect(action.type).toBe('NOOP');
    expect(action.reason).toContain('85%');
  });

  it('decides PAUSE_WORKER when CPU critical', () => {
    const stats: SystemStats = {
      cpuPercent: 95, memoryPercent: 50, memoryUsedMB: 4000, memoryTotalMB: 16000,
      loadAvg: [1, 1, 1], activeWorkers: 2, totalWorkers: 2, pendingTasks: 3,
    };
    const action = monitor.decideAction(stats, config);
    expect(action.type).toBe('PAUSE_WORKER');
    expect(action.reason).toContain('95%');
  });

  it('decides NOOP when no pending tasks', () => {
    const stats: SystemStats = {
      cpuPercent: 30, memoryPercent: 50, memoryUsedMB: 4000, memoryTotalMB: 16000,
      loadAvg: [1, 1, 1], activeWorkers: 2, totalWorkers: 2, pendingTasks: 0,
    };
    const action = monitor.decideAction(stats, config);
    expect(action.type).toBe('NOOP');
  });

  it('decides NOOP when max workers reached', () => {
    const stats: SystemStats = {
      cpuPercent: 30, memoryPercent: 50, memoryUsedMB: 4000, memoryTotalMB: 16000,
      loadAvg: [1, 1, 1], activeWorkers: 4, totalWorkers: 4, pendingTasks: 3,
    };
    const action = monitor.decideAction(stats, config);
    expect(action.type).toBe('NOOP');
  });

  it('start/stop interval', () => {
    let callCount = 0;
    monitor.start(() => { callCount++; });
    expect(monitor['intervalId']).not.toBeNull();
    monitor.stop();
    expect(monitor['intervalId']).toBeNull();
  });
});

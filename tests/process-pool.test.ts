import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessPool } from '../src/process-pool.js';
import { initDatabase } from '../src/db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProcessPool', () => {
  let pool: ProcessPool;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-orch-pool-'));
    initDatabase(tempDir);
    pool = new ProcessPool();
  });

  afterEach(async () => {
    await pool.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates unique worker IDs', () => {
    const id1 = pool.generateId();
    const id2 = pool.generateId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^worker_\d{3}$/);
  });

  it('starts with zero workers', () => {
    expect(pool.getTotalCount()).toBe(0);
    expect(pool.getActiveCount()).toBe(0);
    expect(pool.listWorkers()).toEqual([]);
  });

  it('returns undefined for non-existent worker', () => {
    expect(pool.getWorker('nonexistent')).toBeUndefined();
    expect(pool.pauseWorker('nonexistent')).toBe(false);
    expect(pool.resumeWorker('nonexistent')).toBe(false);
    expect(pool.killWorker('nonexistent')).toBe(false);
  });

  it('findLowestPriorityWorker returns undefined when no workers', () => {
    expect(pool.findLowestPriorityWorker()).toBeUndefined();
  });

  it('emits events', () => {
    const events: string[] = [];
    pool.on('worker:spawned', (id) => events.push(`spawned:${id}`));
    pool.on('worker:paused', (id) => events.push(`paused:${id}`));
    pool.on('worker:resumed', (id) => events.push(`resumed:${id}`));

    pool.emit('worker:spawned', 'w_001', 12345);
    expect(events).toContain('spawned:w_001');
  });

  it('shutdown resolves with no workers', async () => {
    await expect(pool.shutdown()).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, getDataDir, ensureSubdirs } from '../src/config.js';

describe('Config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cc-orch-test-'));
    process.env.CC_ORCH_TEST_DIR = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.CC_ORCH_TEST_DIR;
  });

  it('loads default config when no config file exists', () => {
    const config = loadConfig();
    expect(config.port).toBe(17890);
    expect(config.maxWorkers).toBe(4);
    expect(config.cpuThresholdHigh).toBe(80);
    expect(config.cpuThresholdCritical).toBe(90);
    expect(config.monitorIntervalMs).toBe(5000);
  });

  it('getDataDir returns correct path', () => {
    const config = loadConfig();
    const dir = getDataDir(config);
    expect(dir).toContain('.cc-orchestrator');
  });

  it('ensureSubdirs creates all subdirectories', () => {
    const config = loadConfig();
    ensureSubdirs(config);
    expect(existsSync(join(config.dataDir, 'goals'))).toBe(true);
    expect(existsSync(join(config.dataDir, 'workers'))).toBe(true);
    expect(existsSync(join(config.dataDir, 'transcripts'))).toBe(true);
    expect(existsSync(join(config.dataDir, 'reports'))).toBe(true);
  });
});

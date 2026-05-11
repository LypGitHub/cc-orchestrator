import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { OrchestratorConfig } from './types.js';

const DEFAULT_CONFIG: OrchestratorConfig = {
  port: 17890,
  maxWorkers: 4,
  minWorkers: 0,
  dataDir: join(homedir(), '.cc-orchestrator'),
  cpuThresholdHigh: 80,
  cpuThresholdCritical: 90,
  monitorIntervalMs: 5000,
  defaultMaxTurns: 100,
  defaultModel: 'opus',
};

const CONFIG_FILE_NAME = 'config.json';

function getConfigPath(): string {
  return join(DEFAULT_CONFIG.dataDir, CONFIG_FILE_NAME);
}

function ensureDataDir(): void {
  if (!existsSync(DEFAULT_CONFIG.dataDir)) {
    mkdirSync(DEFAULT_CONFIG.dataDir, { recursive: true });
  }
}

function writeDefaultConfig(): void {
  ensureDataDir();
  const path = getConfigPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

export function loadConfig(): OrchestratorConfig {
  ensureDataDir();
  writeDefaultConfig();

  const configPath = getConfigPath();
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<OrchestratorConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function getDataDir(config?: OrchestratorConfig): string {
  return config?.dataDir ?? DEFAULT_CONFIG.dataDir;
}

export function getGoalsDir(config?: OrchestratorConfig): string {
  return join(getDataDir(config), 'goals');
}

export function getWorkersDir(config?: OrchestratorConfig): string {
  return join(getDataDir(config), 'workers');
}

export function getTranscriptsDir(config?: OrchestratorConfig): string {
  return join(getDataDir(config), 'transcripts');
}

export function getReportsDir(config?: OrchestratorConfig): string {
  return join(getDataDir(config), 'reports');
}

export function ensureSubdirs(config?: OrchestratorConfig): void {
  const dirs = [
    getGoalsDir(config),
    getWorkersDir(config),
    getTranscriptsDir(config),
    getReportsDir(config),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

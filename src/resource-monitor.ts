import os from 'os';
import type { SystemStats, SchedulingAction, OrchestratorConfig } from './types.js';

export class ResourceMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  async sample(): Promise<SystemStats> {
    const cpuPercent = await this.getCPUUsage();
    const memInfo = this.getMemoryInfo();

    return {
      cpuPercent,
      memoryPercent: memInfo.percent,
      memoryUsedMB: memInfo.usedMB,
      memoryTotalMB: memInfo.totalMB,
      loadAvg: os.loadavg(),
      activeWorkers: 0,
      totalWorkers: 0,
      pendingTasks: 0,
    };
  }

  decideAction(stats: SystemStats, config: OrchestratorConfig): SchedulingAction {
    if (stats.cpuPercent > config.cpuThresholdCritical && stats.activeWorkers > 0) {
      return {
        type: 'PAUSE_WORKER',
        reason: `CPU at ${stats.cpuPercent}% exceeds critical threshold ${config.cpuThresholdCritical}%`,
      };
    }

    if (stats.cpuPercent > config.cpuThresholdHigh) {
      return {
        type: 'NOOP',
        reason: `CPU at ${stats.cpuPercent}% exceeds high threshold ${config.cpuThresholdHigh}%, no new workers`,
      };
    }

    if (stats.cpuPercent < config.cpuThresholdHigh - 20 && stats.pendingTasks > 0 && stats.activeWorkers < config.maxWorkers) {
      return {
        type: 'SPAWN_WORKER',
        reason: `CPU at ${stats.cpuPercent}% has headroom, ${stats.pendingTasks} pending tasks`,
      };
    }

    return {
      type: 'NOOP',
      reason: `CPU at ${stats.cpuPercent}%, ${stats.activeWorkers}/${config.maxWorkers} workers, ${stats.pendingTasks} pending`,
    };
  }

  start(callback: (stats: SystemStats, action: SchedulingAction) => void): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      const stats = await this.sample();
      const action = this.decideAction(stats, this.config);
      callback(stats, action);
    }, this.config.monitorIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private lastCPUUsage: { user: number; system: number; idle: number } | null = null;

  private async getCPUUsage(): Promise<number> {
    const cpus = os.cpus();
    let user = 0;
    let system = 0;
    let idle = 0;

    for (const cpu of cpus) {
      const times = cpu.times;
      user += times.user;
      system += times.sys;
      idle += times.idle;
    }

    if (!this.lastCPUUsage) {
      this.lastCPUUsage = { user, system, idle };
      return 0;
    }

    const userDiff = user - this.lastCPUUsage.user;
    const systemDiff = system - this.lastCPUUsage.system;
    const idleDiff = idle - this.lastCPUUsage.idle;
    const totalDiff = userDiff + systemDiff + idleDiff;

    this.lastCPUUsage = { user, system, idle };

    if (totalDiff === 0) return 0;
    return Math.round(((userDiff + systemDiff) / totalDiff) * 100);
  }

  private getMemoryInfo(): { percent: number; usedMB: number; totalMB: number } {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
      percent: Math.round((used / total) * 100),
      usedMB: Math.round(used / 1024 / 1024),
      totalMB: Math.round(total / 1024 / 1024),
    };
  }
}

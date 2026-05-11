import { randomUUID } from 'crypto';
import type {
  OrchestratorConfig, Goal, SubTask, Worker, GoalStatus,
  SystemStatusResponse, CreateGoalRequest, GoalResponse, RoleType,
} from './types.js';
import { ProcessPool } from './process-pool.js';
import { ResourceMonitor } from './resource-monitor.js';
import { GoalSplitter } from './goal-splitter.js';
import { inferRoleFromDescription } from './role-engine.js';
import {
  createGoal, updateGoalStatus, getGoal, listGoals,
  getSubTasksByGoal, getPendingSubTasks, createSubTask, updateSubTaskStatus,
  listWorkers as listDbWorkers, listActiveWorkers,
} from './db.js';

export class Orchestrator {
  private config: OrchestratorConfig;
  private pool: ProcessPool;
  private monitor: ResourceMonitor;
  private splitter: GoalSplitter;
  private running = false;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.pool = new ProcessPool();
    this.monitor = new ResourceMonitor(config);
    this.splitter = new GoalSplitter();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.pool.on('worker:output', (workerId: string, data: Buffer) => {
      // Will be wired with SDK adapter in Task 15
    });

    this.pool.on('worker:error', (workerId: string, error: string) => {
      console.error(`[Worker ${workerId}] Error: ${error.slice(0, 200)}`);
    });

    this.pool.on('worker:exit', async (workerId: string, code: number | null) => {
      console.log(`[Worker ${workerId}] Exited with code ${code}`);
      await this.checkGoalCompletion(workerId);
      await this.scheduleNextTask();
    });

    this.monitor.start((stats, action) => {
      this.handleSchedulingAction(stats, action);
    });
  }

  async createGoal(request: CreateGoalRequest): Promise<Goal> {
    const goal: Goal = {
      id: `goal_${randomUUID().slice(0, 8)}`,
      description: request.description,
      workDir: request.workDir,
      priority: request.priority || 'medium',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    createGoal(goal);
    console.log(`[Goal ${goal.id}] Created: ${goal.description.slice(0, 60)}`);

    setImmediate(() => this.processGoal(goal));

    return goal;
  }

  private async processGoal(goal: Goal): Promise<void> {
    updateGoalStatus(goal.id, 'splitting');

    const subTasks = await this.splitter.split(goal);
    console.log(`[Goal ${goal.id}] Split into ${subTasks.length} subtasks`);

    for (const st of subTasks) {
      try {
        createSubTask(st);
      } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          console.log(`[Goal ${goal.id}] Goal no longer exists, skipping subtask creation`);
          return;
        }
        throw err;
      }
    }

    updateGoalStatus(goal.id, 'running');
    await this.scheduleNextTask();
  }

  private async scheduleNextTask(): Promise<void> {
    const pending = getPendingSubTasks();
    if (pending.length === 0) return;

    const activeWorkers = listActiveWorkers();
    const availableSlots = this.config.maxWorkers - activeWorkers.length;

    if (availableSlots <= 0) return;

    const readyTasks = pending.filter(st => this.areDependenciesMet(st));

    for (let i = 0; i < Math.min(readyTasks.length, availableSlots); i++) {
      const task = readyTasks[i]!;
      const goal = getGoal(task.goalId);
      if (!goal) continue;

      console.log(`[Task ${task.id}] Assigning to new worker (${task.role})`);
      updateSubTaskStatus(task.id, 'assigned');

      this.pool.spawnWorker(goal.id, goal.workDir, task);
    }
  }

  private areDependenciesMet(subTask: SubTask): boolean {
    if (subTask.dependencies.length === 0) return true;
    const allSubTasks = getSubTasksByGoal(subTask.goalId);
    return subTask.dependencies.every(depId => {
      const dep = allSubTasks.find(st => st.id === depId);
      return dep?.status === 'completed';
    });
  }

  private async handleSchedulingAction(stats: any, action: any): Promise<void> {
    stats.activeWorkers = this.pool.getActiveCount();
    stats.totalWorkers = this.pool.getTotalCount();
    stats.pendingTasks = getPendingSubTasks().length;

    switch (action.type) {
      case 'SPAWN_WORKER': {
        console.log(`[Scheduler] ${action.reason}`);
        await this.scheduleNextTask();
        break;
      }
      case 'PAUSE_WORKER': {
        const victim = this.pool.findLowestPriorityWorker();
        if (victim) {
          console.log(`[Scheduler] Pausing worker ${victim.worker.id} due to high CPU`);
          this.pool.pauseWorker(victim.worker.id);
        }
        break;
      }
    }
  }

  private async checkGoalCompletion(workerId: string): Promise<void> {
    const workers = listDbWorkers();
    const worker = workers.find(w => w.id === workerId);
    if (!worker?.goalId) return;

    const subTasks = getSubTasksByGoal(worker.goalId);
    const allDone = subTasks.every(st =>
      st.status === 'completed' || st.status === 'failed'
    );

    if (allDone) {
      const anyFailed = subTasks.some(st => st.status === 'failed');
      updateGoalStatus(worker.goalId, anyFailed ? 'failed' : 'completed');
      console.log(`[Goal ${worker.goalId}] ${anyFailed ? 'Failed' : 'Completed'}`);
    }
  }

  // API handlers
  listGoals(): Goal[] {
    return listGoals();
  }

  getGoal(id: string): GoalResponse | null {
    const goal = getGoal(id);
    if (!goal) return null;
    return {
      goal,
      subTasks: getSubTasksByGoal(id),
      workers: listDbWorkers().filter(w => w.goalId === id),
    };
  }

  listWorkers(): Worker[] {
    return listDbWorkers();
  }

  pauseWorker(id: string): boolean {
    return this.pool.pauseWorker(id);
  }

  resumeWorker(id: string): boolean {
    return this.pool.resumeWorker(id);
  }

  async cancelGoal(id: string): Promise<void> {
    updateGoalStatus(id, 'cancelled');

    const workers = listDbWorkers().filter(w => w.goalId === id);
    for (const w of workers) {
      this.pool.killWorker(w.id, true);
    }

    const subTasks = getSubTasksByGoal(id);
    for (const st of subTasks) {
      if (st.status === 'pending' || st.status === 'queued' || st.status === 'assigned') {
        updateSubTaskStatus(st.id, 'failed', {
          result: {
            success: false,
            output: 'Cancelled',
            filesModified: [],
            toolsUsed: {},
            turnsUsed: 0,
            error: 'Goal cancelled by user',
          },
        });
      }
    }
  }

  getSystemStatus(): SystemStatusResponse {
    return {
      stats: {
        cpuPercent: 0,
        memoryPercent: 0,
        memoryUsedMB: 0,
        memoryTotalMB: 0,
        loadAvg: [0, 0, 0],
        activeWorkers: this.pool.getActiveCount(),
        totalWorkers: this.pool.getTotalCount(),
        pendingTasks: getPendingSubTasks().length,
      },
      workers: listDbWorkers(),
      activeGoals: listGoals().filter(g => g.status === 'running'),
    };
  }

  async shutdown(): Promise<void> {
    this.monitor.stop();
    await this.pool.shutdown();
  }
}

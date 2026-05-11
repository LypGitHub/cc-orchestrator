import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { Worker, WorkerStatus, RoleType, SubTask } from './types.js';
import { getRoleConfig, buildSystemPrompt } from './role-engine.js';
import { createWorker, updateWorkerStatus, deleteWorker, logEvent } from './db.js';
import { SDKAdapter } from './sdk-adapter.js';

export interface WorkerProcess {
  worker: Worker;
  process: ChildProcess;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  goalId: string;
  transcriptBuffer: string[];
}

export class ProcessPool extends EventEmitter {
  private workers = new Map<string, WorkerProcess>();
  private idCounter = 0;
  private sdkAdapter = new SDKAdapter();

  generateId(): string {
    this.idCounter++;
    return `worker_${String(this.idCounter).padStart(3, '0')}`;
  }

  spawnWorker(goalId: string, workDir: string, subTask: SubTask): WorkerProcess {
    const id = this.generateId();
    const role = subTask.role;
    const roleConfig = getRoleConfig(role);

    const claudeArgs = this.buildClaudeArgs(roleConfig, subTask, id);

    const child = spawn('claude', claudeArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: 'sdk-cli',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const worker: Worker = {
      id,
      pid: child.pid!,
      role,
      currentTaskId: subTask.id,
      status: 'idle',
      goalId,
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

    createWorker(worker);

    logEvent({
      worker_id: id,
      goal_id: goalId,
      event_type: 'task_start',
      task_id: subTask.id,
      summary: `Worker ${id} (${role}) started task: ${subTask.title}`,
      details: {
        role,
        taskTitle: subTask.title,
        taskDescription: subTask.description,
      },
    });

    const wp: WorkerProcess = {
      worker,
      process: child,
      stdin: child.stdin!,
      stdout: child.stdout!,
      stderr: child.stderr!,
      goalId,
      transcriptBuffer: [],
    };

    this.workers.set(id, wp);

    child.stdout!.on('data', (data: Buffer) => {
      const wp = this.workers.get(id);
      if (!wp) return;

      const messages = this.sdkAdapter.parseChunk(data);
      for (const msg of messages) {
        this.sdkAdapter.processMessage(id, wp.goalId, msg);

        if (msg.type === 'assistant' && msg.content) {
          wp.transcriptBuffer.push(msg.content);
        }
      }

      this.emit('worker:output', id, data);
    });

    child.stderr!.on('data', (data: Buffer) => {
      this.emit('worker:error', id, data.toString());
    });

    child.on('exit', (code) => {
      this.emit('worker:exit', id, code);
      updateWorkerStatus(id, code === 0 ? 'stopped' : 'error');
    });

    setTimeout(() => {
      this.sendTask(id, subTask);
      updateWorkerStatus(id, 'working');
    }, 1000);

    this.emit('worker:spawned', id, worker.pid);
    return wp;
  }

  private buildClaudeArgs(config: ReturnType<typeof getRoleConfig>, subTask: SubTask, workerId: string): string[] {
    const args: string[] = [
      '-p',                               // --print: non-interactive mode
      '--output-format', 'stream-json',   // JSON Lines output to stdout
      '--input-format', 'stream-json',    // JSON Lines input from stdin
      '--verbose',                        // stream-json requires verbose
      '--dangerously-skip-permissions',
      '--system-prompt', buildSystemPrompt(config.role, subTask.description),
      '--name', `${config.name}-${workerId}`,
      '--max-turns', String(config.maxTurns),
      '--model', config.model,
      '--workload', 'cc-orchestrator',
      '--no-session-persistence',
    ];

    if (config.allowedTools.length > 0) {
      args.push('--allowedTools', config.allowedTools.join(','));
    }
    if (config.forbiddenTools.length > 0) {
      args.push('--disallowedTools', config.forbiddenTools.join(','));
    }

    return args;
  }

  sendTask(workerId: string, subTask: SubTask): boolean {
    const wp = this.workers.get(workerId);
    if (!wp || wp.process.killed) return false;

    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: this.buildTaskPrompt(subTask),
      },
      session_id: '',
      parent_tool_use_id: null,
    };

    wp.stdin.write(JSON.stringify(message) + '\n');
    return true;
  }

  endSession(workerId: string): boolean {
    const wp = this.workers.get(workerId);
    if (!wp || wp.process.killed) return false;

    const message = {
      type: 'control_request',
      request: { subtype: 'end_session', reason: 'task_complete' },
      request_id: `end_${Date.now()}`,
    };

    wp.stdin.write(JSON.stringify(message) + '\n');
    return true;
  }

  private buildTaskPrompt(subTask: SubTask): string {
    return `## Task: ${subTask.title}\n\n${subTask.description}\n\nPlease complete this task. When done, provide a summary of what you accomplished and list any files you modified.`;
  }

  pauseWorker(workerId: string): boolean {
    const wp = this.workers.get(workerId);
    if (!wp) return false;

    try {
      process.kill(wp.worker.pid, 'SIGSTOP');
      updateWorkerStatus(workerId, 'paused');
      wp.worker.status = 'paused';
      logEvent({
        worker_id: workerId,
        goal_id: wp.goalId,
        event_type: 'worker_paused',
        summary: `Worker ${workerId} paused (SIGSTOP)`,
      });
      this.emit('worker:paused', workerId);
      return true;
    } catch {
      return false;
    }
  }

  resumeWorker(workerId: string): boolean {
    const wp = this.workers.get(workerId);
    if (!wp) return false;

    try {
      process.kill(wp.worker.pid, 'SIGCONT');
      updateWorkerStatus(workerId, 'working');
      wp.worker.status = 'working';
      logEvent({
        worker_id: workerId,
        goal_id: wp.goalId,
        event_type: 'worker_resumed',
        summary: `Worker ${workerId} resumed (SIGCONT)`,
      });
      this.emit('worker:resumed', workerId);
      return true;
    } catch {
      return false;
    }
  }

  killWorker(workerId: string, force = false): boolean {
    const wp = this.workers.get(workerId);
    if (!wp) return false;

    try {
      updateWorkerStatus(workerId, 'stopping');
      wp.worker.status = 'stopping';

      logEvent({
        worker_id: workerId,
        goal_id: wp.goalId,
        event_type: 'worker_killed',
        summary: `Worker ${workerId} killed (${force ? 'SIGKILL' : 'SIGTERM'})`,
      });

      if (force) {
        wp.process.kill('SIGKILL');
      } else {
        wp.process.kill('SIGTERM');
        setTimeout(() => {
          if (!wp.process.killed) {
            wp.process.kill('SIGKILL');
          }
        }, 5000);
      }

      this.workers.delete(workerId);
      return true;
    } catch {
      return false;
    }
  }

  getWorker(workerId: string): WorkerProcess | undefined {
    return this.workers.get(workerId);
  }

  listWorkers(): Worker[] {
    return Array.from(this.workers.values()).map(wp => wp.worker);
  }

  getActiveCount(): number {
    return Array.from(this.workers.values()).filter(
      wp => wp.worker.status === 'working' || wp.worker.status === 'idle'
    ).length;
  }

  getTotalCount(): number {
    return this.workers.size;
  }

  findLowestPriorityWorker(): WorkerProcess | undefined {
    const working = Array.from(this.workers.values()).filter(
      wp => wp.worker.status === 'working'
    );
    if (working.length === 0) return undefined;
    return working.sort((a, b) =>
      new Date(a.worker.startTime).getTime() - new Date(b.worker.startTime).getTime()
    )[0];
  }

  shutdown(): Promise<void> {
    return new Promise((resolve) => {
      const workerIds = Array.from(this.workers.keys());
      let done = 0;

      if (workerIds.length === 0) {
        resolve();
        return;
      }

      for (const id of workerIds) {
        this.killWorker(id, false);
        setTimeout(() => {
          deleteWorker(id);
          done++;
          if (done >= workerIds.length) resolve();
        }, 100);
      }
    });
  }
}

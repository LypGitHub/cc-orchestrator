#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, ensureSubdirs } from './config.js';
import { startServer } from './server.js';
import { initDatabase } from './db.js';

const program = new Command();
const pkg = { name: 'cc-orchestrator', version: '0.1.0' };

program
  .name('cc-orch')
  .description('Claude Code Orchestrator - intelligent multi-process coding agent manager')
  .version(pkg.version);

// Start daemon
program
  .command('start')
  .description('Start the orchestrator daemon')
  .option('-p, --port <port>', 'HTTP API port', '17890')
  .option('--max-workers <n>', 'Maximum concurrent workers', '4')
  .action(async (options) => {
    const config = loadConfig();
    const port = parseInt(options.port) || config.port;
    const maxWorkers = parseInt(options.maxWorkers) || config.maxWorkers;

    ensureSubdirs(config);
    initDatabase(config.dataDir);

    console.log(`Starting CC Orchestrator on port ${port}...`);
    console.log(`Max workers: ${maxWorkers}`);
    console.log(`Data dir: ${config.dataDir}`);

    await startServer({ ...config, port, maxWorkers });
  });

// Stop daemon
program
  .command('stop')
  .description('Stop the orchestrator daemon')
  .action(async () => {
    console.log('Stopping CC Orchestrator...');
  });

// Submit goal
program
  .command('run <description>')
  .description('Submit a new goal to the orchestrator')
  .option('-d, --dir <dir>', 'Working directory', process.cwd())
  .option('--workers <n>', 'Max workers for this goal')
  .option('--priority <level>', 'Priority (low|medium|high)', 'medium')
  .action(async (description, options) => {
    const config = loadConfig();
    const response = await fetch(`http://localhost:${config.port}/api/v1/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        workDir: options.dir,
        priority: options.priority,
        maxWorkers: options.workers ? parseInt(options.workers) : undefined,
      }),
    });
    const data = await response.json() as { goal: { id: string; status: string } };
    console.log(`Goal submitted: ${data.goal.id}`);
    console.log(`Status: ${data.goal.status}`);
  });

// List goals
program
  .command('list')
  .description('List all goals')
  .action(async () => {
    const config = loadConfig();
    const response = await fetch(`http://localhost:${config.port}/api/v1/goals`);
    const data = await response.json() as { goals: Array<{ id: string; status: string; description: string }> };
    console.log('Goals:');
    for (const goal of data.goals) {
      console.log(`  ${goal.id} [${goal.status}] ${goal.description.slice(0, 50)}`);
    }
  });

// View goal status
program
  .command('status <goal-id>')
  .description('View goal status and progress')
  .action(async (goalId) => {
    const config = loadConfig();
    const response = await fetch(`http://localhost:${config.port}/api/v1/goals/${goalId}`);
    const data = await response.json() as unknown;
    console.log(JSON.stringify(data, null, 2));
  });

// View workers
program
  .command('workers')
  .description('List all workers')
  .action(async () => {
    const config = loadConfig();
    const response = await fetch(`http://localhost:${config.port}/api/v1/workers`);
    const data = await response.json() as { workers: Array<{ id: string; status: string; pid: number; role: string; currentTaskId?: string }> };
    console.log('Workers:');
    for (const w of data.workers) {
      console.log(`  ${w.id} [${w.status}] pid=${w.pid} role=${w.role} task=${w.currentTaskId || 'none'}`);
    }
  });

// System status
program
  .command('system')
  .description('View system resources')
  .action(async () => {
    const config = loadConfig();
    const response = await fetch(`http://localhost:${config.port}/api/v1/system`);
    const data = await response.json() as { stats: { cpuPercent: number; memoryUsedMB: number; memoryTotalMB: number; memoryPercent: number; activeWorkers: number; pendingTasks: number } };
    console.log(`CPU: ${data.stats.cpuPercent}%`);
    console.log(`Memory: ${data.stats.memoryUsedMB}MB / ${data.stats.memoryTotalMB}MB (${data.stats.memoryPercent}%)`);
    console.log(`Active Workers: ${data.stats.activeWorkers}`);
    console.log(`Pending Tasks: ${data.stats.pendingTasks}`);
  });

// Pause worker
program
  .command('pause <worker-id>')
  .description('Pause a worker (SIGSTOP)')
  .action(async (workerId) => {
    const config = loadConfig();
    await fetch(`http://localhost:${config.port}/api/v1/workers/${workerId}/pause`, { method: 'POST' });
    console.log(`Worker ${workerId} paused`);
  });

// Resume worker
program
  .command('resume <worker-id>')
  .description('Resume a worker (SIGCONT)')
  .action(async (workerId) => {
    const config = loadConfig();
    await fetch(`http://localhost:${config.port}/api/v1/workers/${workerId}/resume`, { method: 'POST' });
    console.log(`Worker ${workerId} resumed`);
  });

// Cancel goal
program
  .command('cancel <goal-id>')
  .description('Cancel a goal and all its workers')
  .action(async (goalId) => {
    const config = loadConfig();
    await fetch(`http://localhost:${config.port}/api/v1/goals/${goalId}/cancel`, { method: 'POST' });
    console.log(`Goal ${goalId} cancelled`);
  });

program.parse();

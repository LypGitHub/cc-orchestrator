import Fastify from 'fastify';
import type { OrchestratorConfig } from './types.js';
import { Orchestrator } from './orchestrator.js';

let orchestrator: Orchestrator | null = null;

export async function startServer(config: OrchestratorConfig): Promise<void> {
  const app = Fastify({ logger: false });
  orchestrator = new Orchestrator(config);

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  // Create goal
  app.post('/api/v1/goals', async (request, reply) => {
    const body = request.body as { description: string; workDir: string; priority?: string; maxWorkers?: number };
    if (!body.description || !body.workDir) {
      return reply.status(400).send({ error: 'description and workDir are required' });
    }
    const goal = await orchestrator!.createGoal({
      description: body.description,
      workDir: body.workDir,
      priority: (body.priority as any) || 'medium',
      maxWorkers: body.maxWorkers,
    });
    return { goal, subTasks: [], workers: [] };
  });

  // List goals
  app.get('/api/v1/goals', async () => {
    const goals = orchestrator!.listGoals();
    return { goals };
  });

  // Get goal
  app.get('/api/v1/goals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = orchestrator!.getGoal(id);
    if (!result) return reply.status(404).send({ error: 'Goal not found' });
    return result;
  });

  // Cancel goal
  app.post('/api/v1/goals/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    await orchestrator!.cancelGoal(id);
    return { success: true };
  });

  // List workers
  app.get('/api/v1/workers', async () => {
    const workers = orchestrator!.listWorkers();
    return { workers };
  });

  // Pause worker
  app.post('/api/v1/workers/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = orchestrator!.pauseWorker(id);
    return { success };
  });

  // Resume worker
  app.post('/api/v1/workers/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = orchestrator!.resumeWorker(id);
    return { success };
  });

  // System status
  app.get('/api/v1/system', async () => {
    return orchestrator!.getSystemStatus();
  });

  await app.listen({ port: config.port, host: '127.0.0.1' });
  console.log(`Server listening on http://127.0.0.1:${config.port}`);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await orchestrator!.shutdown();
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await orchestrator!.shutdown();
    await app.close();
    process.exit(0);
  });
}

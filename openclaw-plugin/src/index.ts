// ============================================================================
// CC Orchestrator -- OpenClaw Plugin
//
// Provides OpenClaw commands to interact with CC Orchestrator's HTTP API.
// Commands: /cc-orch-run, /cc-orch-list, /cc-orch-status, /cc-orch-workers,
//           /cc-orch-system, /cc-orch-pause, /cc-orch-resume, /cc-orch-cancel
// ============================================================================

// -- Minimal type declarations for OpenClaw Plugin SDK ------------------------

interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface PluginCommandContext {
  senderId?: string;
  channel: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
}

type PluginCommandResult = string | { text: string } | { text: string; format?: string };

interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  source: string;
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerCommand: (command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    requireAuth?: boolean;
    handler: (ctx: PluginCommandContext) => PluginCommandResult | Promise<PluginCommandResult>;
  }) => void;
  registerService: (service: {
    id: string;
    start: (ctx: { config: Record<string, unknown>; stateDir: string; logger: PluginLogger }) => void | Promise<void>;
    stop?: (ctx: { config: Record<string, unknown>; stateDir: string; logger: PluginLogger }) => void | Promise<void>;
  }) => void;
}

// -- Plugin Configuration -----------------------------------------------------

interface CcOrchestratorConfig {
  apiHost?: string;
  apiPort?: number;
}

const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = 17890;

// -- HTTP Client --------------------------------------------------------------

function getBaseUrl(config: CcOrchestratorConfig): string {
  const host = config.apiHost || DEFAULT_API_HOST;
  const port = config.apiPort || DEFAULT_API_PORT;
  return `http://${host}:${port}`;
}

async function apiGet(
  baseUrl: string,
  path: string,
  logger: PluginLogger
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`);
    if (!response.ok) {
      logger.warn(`[cc-orch] API GET ${path} returned ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[cc-orch] API GET ${path} failed: ${message}`);
    return null;
  }
}

async function apiPost(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  logger: PluginLogger
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      logger.warn(`[cc-orch] API POST ${path} returned ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[cc-orch] API POST ${path} failed: ${message}`);
    return null;
  }
}

// -- Formatting Helpers -------------------------------------------------------

function formatGoal(goal: Record<string, unknown>): string {
  const id = String(goal.id || "unknown");
  const status = String(goal.status || "unknown");
  const desc = String(goal.description || "").slice(0, 60);
  const priority = String(goal.priority || "medium");
  const workers = goal.maxWorkers != null ? ` workers=${goal.maxWorkers}` : "";
  return `[${status}] ${id} (${priority})${workers} — ${desc}`;
}

function formatWorker(w: Record<string, unknown>): string {
  const id = String(w.id || "unknown");
  const status = String(w.status || "unknown");
  const pid = w.pid != null ? ` pid=${w.pid}` : "";
  const role = w.role ? ` role=${w.role}` : "";
  const task = w.currentTaskId ? ` task=${w.currentTaskId}` : "";
  return `[${status}] ${id}${pid}${role}${task}`;
}

function formatSystemStatus(data: Record<string, unknown>): string {
  const stats = data.stats as Record<string, unknown> | undefined;
  if (!stats) return "System status unavailable";
  const cpu = stats.cpuPercent;
  const memUsed = stats.memoryUsedMB;
  const memTotal = stats.memoryTotalMB;
  const memPct = stats.memoryPercent;
  const active = stats.activeWorkers;
  const pending = stats.pendingTasks;
  return [
    "System Status",
    `  CPU: ${cpu}%`,
    `  Memory: ${memUsed}MB / ${memTotal}MB (${memPct}%)`,
    `  Active Workers: ${active}`,
    `  Pending Tasks: ${pending}`,
  ].join("\n");
}

function formatGoalDetail(data: Record<string, unknown>): string {
  const goal = data.goal as Record<string, unknown> | undefined;
  const subTasks = data.subTasks as Array<Record<string, unknown>> | undefined;
  const workers = data.workers as Array<Record<string, unknown>> | undefined;

  if (!goal) return "Goal not found";

  const lines: string[] = [
    `Goal: ${goal.id}`,
    `Status: ${goal.status}`,
    `Description: ${goal.description}`,
    `Priority: ${goal.priority}`,
    `Work Dir: ${goal.workDir}`,
  ];

  if (subTasks && subTasks.length > 0) {
    lines.push("", "Sub Tasks:");
    for (const st of subTasks) {
      lines.push(`  [${st.status || "pending"}] ${st.id}: ${String(st.description || "").slice(0, 50)}`);
    }
  }

  if (workers && workers.length > 0) {
    lines.push("", "Workers:");
    for (const w of workers) {
      lines.push(`  ${formatWorker(w)}`);
    }
  }

  return lines.join("\n");
}

// -- Plugin Entry Point -------------------------------------------------------

export default function ccOrchestratorPlugin(api: OpenClawPluginApi): void {
  const userConfig = (api.pluginConfig || {}) as CcOrchestratorConfig;
  const baseUrl = getBaseUrl(userConfig);

  // ------------------------------------------------------------------
  // Command: /cc-orch-run <description> [--dir <dir>] [--workers <n>] [--priority <level>]
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-run",
    description: "Submit a new goal to CC Orchestrator",
    acceptsArgs: true,
    handler: async (ctx) => {
      const raw = ctx.args?.trim() || "";
      if (!raw) {
        return "Usage: /cc-orch-run <description> [--dir <dir>] [--workers <n>] [--priority <low|medium|high>]";
      }

      // Simple arg parsing: description comes first, then flags
      const args: Record<string, string> = {};
      let description = raw;

      // Check for --dir flag
      const dirMatch = raw.match(/--dir\s+(\S+)/);
      if (dirMatch) {
        args.dir = dirMatch[1];
        description = description.replace(dirMatch[0], "").trim();
      }

      // Check for --workers flag
      const workersMatch = raw.match(/--workers\s+(\d+)/);
      if (workersMatch) {
        args.workers = workersMatch[1];
        description = description.replace(workersMatch[0], "").trim();
      }

      // Check for --priority flag
      const priorityMatch = raw.match(/--priority\s+(\w+)/);
      if (priorityMatch) {
        args.priority = priorityMatch[1];
        description = description.replace(priorityMatch[0], "").trim();
      }

      if (!description) {
        return "Error: Description is required. Usage: /cc-orch-run <description> [--dir <dir>] [--workers <n>] [--priority <level>]";
      }

      const body: Record<string, unknown> = {
        description,
        workDir: args.dir || process.cwd(),
      };
      if (args.priority) body.priority = args.priority;
      if (args.workers) body.maxWorkers = parseInt(args.workers, 10);

      const data = await apiPost(baseUrl, "/api/v1/goals", body, api.logger);
      if (!data) {
        return `Failed to submit goal. Is CC Orchestrator running? (${baseUrl})`;
      }

      const goal = data.goal as Record<string, unknown> | undefined;
      if (!goal) {
        return "Goal submitted but no ID returned.";
      }

      return `Goal submitted: ${goal.id}\nStatus: ${goal.status}\nDescription: ${description}`;
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-list
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-list",
    description: "List all goals in CC Orchestrator",
    handler: async () => {
      const data = await apiGet(baseUrl, "/api/v1/goals", api.logger);
      if (!data) {
        return `Failed to list goals. Is CC Orchestrator running? (${baseUrl})`;
      }

      const goals = Array.isArray(data.goals) ? data.goals : [];
      if (goals.length === 0) {
        return "No goals found.";
      }

      return [
        "Goals:",
        ...goals.map((g) => formatGoal(g as Record<string, unknown>)),
      ].join("\n");
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-status [goal-id]
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-status",
    description: "View goal status and progress",
    acceptsArgs: true,
    handler: async (ctx) => {
      const goalId = ctx.args?.trim();
      if (!goalId) {
        // No goal ID provided — show latest goal
        const listData = await apiGet(baseUrl, "/api/v1/goals", api.logger);
        if (!listData) {
          return `Failed to fetch goals. Is CC Orchestrator running? (${baseUrl})`;
        }
        const goals = Array.isArray(listData.goals) ? listData.goals : [];
        if (goals.length === 0) {
          return "No goals found. Submit one with /cc-orch-run <description>";
        }
        const latest = goals[goals.length - 1] as Record<string, unknown>;
        const id = String(latest.id);
        const detailData = await apiGet(baseUrl, `/api/v1/goals/${id}`, api.logger);
        if (!detailData) {
          return `Failed to fetch goal ${id}`;
        }
        return formatGoalDetail(detailData);
      }

      const data = await apiGet(baseUrl, `/api/v1/goals/${goalId}`, api.logger);
      if (!data) {
        return `Goal not found: ${goalId}`;
      }
      return formatGoalDetail(data);
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-workers
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-workers",
    description: "List all workers in CC Orchestrator",
    handler: async () => {
      const data = await apiGet(baseUrl, "/api/v1/workers", api.logger);
      if (!data) {
        return `Failed to list workers. Is CC Orchestrator running? (${baseUrl})`;
      }

      const workers = Array.isArray(data.workers) ? data.workers : [];
      if (workers.length === 0) {
        return "No active workers.";
      }

      return [
        `Workers (${workers.length}):`,
        ...workers.map((w) => formatWorker(w as Record<string, unknown>)),
      ].join("\n");
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-system
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-system",
    description: "View system resources and status",
    handler: async () => {
      const data = await apiGet(baseUrl, "/api/v1/system", api.logger);
      if (!data) {
        return `Failed to fetch system status. Is CC Orchestrator running? (${baseUrl})`;
      }
      return formatSystemStatus(data);
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-pause <worker-id>
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-pause",
    description: "Pause a worker (SIGSTOP)",
    acceptsArgs: true,
    handler: async (ctx) => {
      const workerId = ctx.args?.trim();
      if (!workerId) {
        return "Usage: /cc-orch-pause <worker-id>";
      }
      const data = await apiPost(baseUrl, `/api/v1/workers/${workerId}/pause`, {}, api.logger);
      if (!data) {
        return `Failed to pause worker ${workerId}. Is CC Orchestrator running?`;
      }
      const success = (data as Record<string, unknown>).success;
      return success ? `Worker ${workerId} paused.` : `Failed to pause worker ${workerId}.`;
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-resume <worker-id>
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-resume",
    description: "Resume a worker (SIGCONT)",
    acceptsArgs: true,
    handler: async (ctx) => {
      const workerId = ctx.args?.trim();
      if (!workerId) {
        return "Usage: /cc-orch-resume <worker-id>";
      }
      const data = await apiPost(baseUrl, `/api/v1/workers/${workerId}/resume`, {}, api.logger);
      if (!data) {
        return `Failed to resume worker ${workerId}. Is CC Orchestrator running?`;
      }
      const success = (data as Record<string, unknown>).success;
      return success ? `Worker ${workerId} resumed.` : `Failed to resume worker ${workerId}.`;
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-cancel <goal-id>
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-cancel",
    description: "Cancel a goal and all its workers",
    acceptsArgs: true,
    handler: async (ctx) => {
      const goalId = ctx.args?.trim();
      if (!goalId) {
        return "Usage: /cc-orch-cancel <goal-id>";
      }
      const data = await apiPost(baseUrl, `/api/v1/goals/${goalId}/cancel`, {}, api.logger);
      if (!data) {
        return `Failed to cancel goal ${goalId}. Is CC Orchestrator running?`;
      }
      return `Goal ${goalId} cancelled.`;
    },
  });

  // ------------------------------------------------------------------
  // Command: /cc-orch-help
  // ------------------------------------------------------------------
  api.registerCommand({
    name: "cc-orch-help",
    description: "Show CC Orchestrator command help",
    handler: () => {
      return [
        "CC Orchestrator Commands",
        "",
        "/cc-orch-run <description> [--dir <dir>] [--workers <n>] [--priority <level>]",
        "  Submit a new coding goal to the orchestrator",
        "",
        "/cc-orch-list",
        "  List all goals",
        "",
        "/cc-orch-status [goal-id]",
        "  View goal status (shows latest if no ID given)",
        "",
        "/cc-orch-workers",
        "  List all workers",
        "",
        "/cc-orch-system",
        "  View system resources (CPU, memory, active workers)",
        "",
        "/cc-orch-pause <worker-id>",
        "  Pause a worker process (SIGSTOP)",
        "",
        "/cc-orch-resume <worker-id>",
        "  Resume a worker process (SIGCONT)",
        "",
        "/cc-orch-cancel <goal-id>",
        "  Cancel a goal and all its workers",
        "",
        "Tip: Start the orchestrator first with: cc-orch start",
      ].join("\n");
    },
  });

  api.logger.info(`[cc-orch] OpenClaw plugin loaded — API: ${baseUrl}`);
}

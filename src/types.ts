// Goal & SubTask
export interface Goal {
  id: string;
  description: string;
  workDir: string;
  priority: Priority;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SubTask {
  id: string;
  goalId: string;
  title: string;
  description: string;
  role: RoleType;
  dependencies: string[];
  estimatedEffort: number;
  status: SubTaskStatus;
  assignedWorkerId?: string;
  result?: SubTaskResult;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SubTaskResult {
  success: boolean;
  output: string;
  filesModified: string[];
  toolsUsed: Record<string, number>;
  turnsUsed: number;
  error?: string;
}

export type Priority = 'low' | 'medium' | 'high';
export type GoalStatus = 'pending' | 'splitting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SubTaskStatus = 'pending' | 'queued' | 'assigned' | 'running' | 'completed' | 'failed';

// Role System
export type RoleType =
  | 'backend-engineer'
  | 'frontend-engineer'
  | 'devops-engineer'
  | 'qa-engineer'
  | 'architect'
  | 'code-reviewer'
  | 'debugger'
  | 'general';

export interface RoleConfig {
  role: RoleType;
  name: string;
  systemPrompt: string;
  allowedTools: string[];
  forbiddenTools: string[];
  maxTurns: number;
  model: string;
}

// Worker (Process)
export interface Worker {
  id: string;
  pid: number;
  role: RoleType;
  currentTaskId?: string;
  status: WorkerStatus;
  goalId?: string;
  startTime: string;
  lastActivity: string;
  stats: WorkerStats;
}

export type WorkerStatus = 'idle' | 'working' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface WorkerStats {
  turnsUsed: number;
  toolsUsed: Record<string, number>;
  filesModified: string[];
  errors: number;
  tokensInput: number;
  tokensOutput: number;
}

// Stream-JSON Protocol
export interface StreamMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'done' | 'error' | 'thinking';
  id?: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  error?: string;
  thinking?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

// System Resources
export interface SystemStats {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  loadAvg: number[];
  activeWorkers: number;
  totalWorkers: number;
  pendingTasks: number;
}

// Scheduling
export interface SchedulingAction {
  type: 'SPAWN_WORKER' | 'PAUSE_WORKER' | 'RESUME_WORKER' | 'KILL_WORKER' | 'NOOP';
  target?: string;
  role?: RoleType;
  reason: string;
}

// Config
export interface OrchestratorConfig {
  port: number;
  maxWorkers: number;
  minWorkers: number;
  dataDir: string;
  cpuThresholdHigh: number;
  cpuThresholdCritical: number;
  monitorIntervalMs: number;
  defaultMaxTurns: number;
  defaultModel: string;
  notifications?: {
    dingtalk?: { enabled: boolean; webhook: string };
    slack?: { enabled: boolean; webhook: string };
  };
}

// API Request/Response
export interface CreateGoalRequest {
  description: string;
  workDir: string;
  priority?: Priority;
  maxWorkers?: number;
}

export interface GoalResponse {
  goal: Goal;
  subTasks: SubTask[];
  workers: Worker[];
}

export interface SystemStatusResponse {
  stats: SystemStats;
  workers: Worker[];
  activeGoals: Goal[];
}

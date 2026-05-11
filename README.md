# CC Orchestrator / Claude Code 进程编排器

<p align="center">
  <strong>智能管理多个 Claude Code 进程，自动拆解目标、分配角色、调度执行</strong>
  <br>
  <em>Intelligently orchestrate multiple Claude Code processes with automatic goal decomposition, role assignment, and resource-aware scheduling</em>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#架构">架构</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#cli-命令">CLI 命令</a> |
  <a href="#cli-commands">CLI Commands</a>
</p>

---

## 简介 / Overview

**CC Orchestrator** 是一个智能化的 Claude Code 进程管理系统，能够：

- **自动拆解目标**：将用户的大目标分解为可并行执行的子任务（带依赖图）
- **角色分配**：为每个工作进程分配预定义角色（后端工程师、前端工程师、QA、架构师等）
- **资源感知调度**：根据 CPU/内存状态智能决定进程数量，CPU 紧张时自动暂停低优先级任务
- **实时监控**：跟踪每个进程的对话状态、工具调用、文件修改
- **结果合并**：任务完成后自动聚合所有子任务结果并生成报告

**CC Orchestrator** is an intelligent Claude Code process management system that:

- **Auto-decomposes goals**: Breaks user goals into parallel subtasks with dependency graphs
- **Role assignment**: Assigns predefined roles to each worker (backend engineer, frontend engineer, QA, architect, etc.)
- **Resource-aware scheduling**: Intelligently manages worker count based on CPU/memory, auto-pauses low-priority tasks when CPU is high
- **Real-time monitoring**: Tracks conversation state, tool usage, and file modifications per worker
- **Result aggregation**: Automatically merges subtask results and generates reports upon completion

---

## 核心功能 / Features

| 功能 / Feature | 中文描述 | English Description |
|---|---|---|
| 目标拆解 / Goal Splitting | 基于规则引擎 + LLM 辅助，自动拆解为子任务 DAG | Rule-based + LLM-assisted decomposition into subtask DAGs |
| 角色系统 / Role System | 8 个预定义角色，每个有独立的 system prompt 和工具权限 | 8 predefined roles with independent system prompts and tool permissions |
| 进程池 / Process Pool | 管理 Claude Code CLI 进程生命周期（spawn/pause/resume/kill） | Manages Claude Code CLI process lifecycle |
| 资源监控 / Resource Monitor | 每 5 秒采样 CPU/内存，智能调度决策 | CPU/memory sampling every 5s with intelligent scheduling |
| 暂停/恢复 / Pause/Resume | 使用 Unix SIGSTOP/SIGCONT 信号精确控制 | Precise control via Unix SIGSTOP/SIGCONT signals |
| Stream-JSON 协议 / Stream-JSON Protocol | 通过 stdin/stdout 与 Claude Code 实时双向通信 | Real-time bidirectional communication via stdin/stdout |
| 报告生成 / Report Generation | 任务完成后自动生成 Markdown 报告 | Auto-generates Markdown reports upon completion |
| 多平台技能 / Multi-Platform Skill | 支持 Claude Code、OpenClaw、Codex 等多种 Agent 平台 | Supports Claude Code, OpenClaw, Codex agent platforms |

---

## 架构 / Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    用户交互层 / User Layer                     │
│  ┌─────────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │ /orchestrator   │  │ cc-orch CLI │  │ OpenClaw Skill   │ │
│  │ (Claude Skill)  │  │             │  │                  │ │
│  └────────┬────────┘  └──────┬──────┘  └────────┬─────────┘ │
│           │                  │                  │           │
│           └──────────────────┼──────────────────┘           │
│                              ▼ HTTP API                     │
├──────────────────────────────┴──────────────────────────────┤
│              Orchestrator Service (Node.js)                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Task Queue   │ │ Role Engine  │ │ Process Pool │        │
│  │ Goal Splitter│ │ State Tracker│ │ Resource Mon │        │
│  │ Result Merger│ │ Report Gen   │ │ Scheduler    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                              │                              │
│                              ▼ stdin/stdout stream-json     │
│  ┌───────────────────────────┬───────────────────────────┐  │
│  │ Worker 1 (CC CLI)         │ Worker 2 (CC CLI)    ...  │  │
│  │ --print --output-format   │ --print --output-format   │  │
│  │ stream-json --verbose     │ stream-json --verbose     │  │
│  │ Role: backend-engineer    │ Role: frontend-engineer   │  │
│  └───────────────────────────┴───────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 快速开始 / Quick Start

### 安装 / Installation

```bash
# Clone 仓库
# Clone the repository
git clone https://github.com/LypGitHub/cc-orchestrator.git
cd cc-orchestrator

# 安装依赖
# Install dependencies
npm install

# 编译 TypeScript
# Build TypeScript
npm run build

# 安装为 OpenClaw Skill（可选）
# Install as OpenClaw Skill (optional)
bash install_as_skill.sh --target openclaw
```

#### OpenClaw 插件安装 / OpenClaw Plugin Installation

如果选择 `--target openclaw` 或系统检测到 OpenClaw，安装脚本会自动：
- 构建 `openclaw-plugin/` 目录中的 OpenClaw 插件
- 将插件复制到 `~/.claude/plugins/marketplaces/lypgithub/cc-orchestrator/`
- 自动配置 `~/.openclaw/openclaw.json` 注册插件

When `--target openclaw` or OpenClaw is detected, the install script will:
- Build the OpenClaw plugin from `openclaw-plugin/`
- Copy it to `~/.claude/plugins/marketplaces/lypgithub/cc-orchestrator/`
- Auto-configure `~/.openclaw/openclaw.json` to register the plugin

### 后台服务 / Background Service (macOS)

安装脚本会自动将 cc-orchestrator 注册为 macOS launchd 后台服务，开机自启动：

The install script automatically registers cc-orchestrator as a macOS launchd background service with auto-start on boot:

| 操作 / Operation | 命令 / Command |
|---|---|
| 查看状态 / Check status | `launchctl list \| grep ai.cc-orchestrator` |
| 停止服务 / Stop service | `launchctl unload ~/Library/LaunchAgents/ai.cc-orchestrator.gateway.plist` |
| 启动服务 / Start service | `launchctl load ~/Library/LaunchAgents/ai.cc-orchestrator.gateway.plist` |
| 查看日志 / View logs | `tail -f ~/.cc-orchestrator/logs/gateway.log` |
| 查看错误 / View errors | `tail -f ~/.cc-orchestrator/logs/gateway.err.log` |

**手动启动（开发调试用）/ Manual start (for development):**
```bash
./bin/cc-orch start [--port 17890 --max-workers 4]
# or
node dist/cli.js start
```

### 提交目标 / Submit a Goal

```bash
# 提交一个开发目标
# Submit a development goal
./bin/cc-orch run "实现用户认证系统，包含登录、注册、JWT token" \
  --dir ~/works/my-project \
  --workers 3 \
  --priority high
```

### 查看状态 / Check Status

```bash
# 查看系统资源状态
./bin/cc-orch system

# 查看所有进行中的目标
./bin/cc-orch list

# 查看目标详情
./bin/cc-orch status <goal-id>

# 查看所有 Worker
./bin/cc-orch workers
```

### 管理进程 / Manage Workers

```bash
# 暂停 Worker (SIGSTOP)
./bin/cc-orch pause <worker-id>

# 恢复 Worker (SIGCONT)
./bin/cc-orch resume <worker-id>

# 取消目标
./bin/cc-orch cancel <goal-id>
```

---

## CLI 命令 / CLI Commands

| 命令 / Command | 中文说明 | English Description |
|---|---|---|
| `start [options]` | 启动编排器服务 | Start the orchestrator daemon |
| `stop` | 停止服务 | Stop the daemon |
| `run <description> [options]` | 提交新目标 | Submit a new goal |
| `list` | 列出所有目标 | List all goals |
| `status <goal-id>` | 查看目标状态 | View goal status |
| `workers` | 查看所有 Worker | List all workers |
| `system` | 查看系统资源 | View system resources |
| `pause <worker-id>` | 暂停 Worker | Pause a worker (SIGSTOP) |
| `resume <worker-id>` | 恢复 Worker | Resume a worker (SIGCONT) |
| `cancel <goal-id>` | 取消目标 | Cancel a goal |

### OpenClaw 命令 / OpenClaw Commands

安装 OpenClaw 插件后，可在 OpenClaw 对话中直接使用以下命令：

After installing the OpenClaw plugin, these commands are available in OpenClaw conversations:

| 命令 / Command | 中文说明 | English Description |
|---|---|---|
| `/cc-orch-run <description>` | 提交新目标 | Submit a new goal |
| `/cc-orch-list` | 列出所有目标 | List all goals |
| `/cc-orch-status [goal-id]` | 查看目标状态 | View goal status (latest if no ID) |
| `/cc-orch-workers` | 查看所有 Worker | List all workers |
| `/cc-orch-system` | 查看系统资源 | View system resources |
| `/cc-orch-pause <worker-id>` | 暂停 Worker | Pause a worker (SIGSTOP) |
| `/cc-orch-resume <worker-id>` | 恢复 Worker | Resume a worker (SIGCONT) |
| `/cc-orch-cancel <goal-id>` | 取消目标 | Cancel a goal |
| `/cc-orch-help` | 显示帮助 | Show command help |

**示例 / Example:**
```
/cc-orch-run "实现用户认证系统，包含登录、注册、JWT token" --dir ~/works/my-project --workers 3 --priority high
```

---

## 角色系统 / Role System

每个 Worker 被分配一个预定义角色，带有独立的 system prompt 和工具权限：

Each worker is assigned a predefined role with its own system prompt and tool permissions:

| 角色 / Role | 职责 / Responsibility |
|---|---|
| `backend-engineer` | API 设计、数据库、服务端逻辑 / API design, database, server-side logic |
| `frontend-engineer` | UI 组件、页面、交互 / UI components, pages, interactions |
| `devops-engineer` | 部署、Docker、CI/CD / Deployment, Docker, CI/CD |
| `qa-engineer` | 测试用例、Bug 修复验证 / Test cases, bug fix verification |
| `architect` | 架构设计、重构方案 / Architecture design, refactoring |
| `code-reviewer` | 代码审查、安全审计 / Code review, security audit |
| `debugger` | Bug 定位、根因分析 / Bug isolation, root cause analysis |
| `general` | 通用开发任务 / General development tasks |

---

## 配置 / Configuration

编辑 `~/.cc-orchestrator/config.json`：

Edit `~/.cc-orchestrator/config.json`:

```json
{
  "port": 17890,
  "maxWorkers": 4,
  "minWorkers": 0,
  "dataDir": "/Users/<username>/.cc-orchestrator",
  "cpuThresholdHigh": 80,
  "cpuThresholdCritical": 90,
  "monitorIntervalMs": 5000,
  "defaultMaxTurns": 100,
  "defaultModel": "opus"
}
```

环境变量 / Environment variables:
- `CC_ORCH_DATA_DIR` — 自定义数据目录 / Custom data directory
- `CLAUDE_CODE_ENTRYPOINT` — Claude Code 入口标识 / Entrypoint identifier

---

## 工作流程 / Workflow

```
用户描述目标 → Goal Splitter 拆解为子任务 DAG
  → Resource Monitor 根据 CPU 决定并发数
  → Process Pool 为每个子任务 spawn Claude Code 进程
  → 每个进程通过 stream-json 协议实时通信
  → CPU 紧张时自动 SIGSTOP 低优先级进程
  → 子任务完成后自动调度下一个
  → 所有任务完成后合并结果、生成报告
```

```
User describes goal → Goal Splitter decomposes into subtask DAG
  → Resource Monitor decides concurrency based on CPU
  → Process Pool spawns Claude Code process per subtask
  → Each process communicates via stream-json protocol
  → Auto SIGSTOP low-priority processes when CPU is high
  → Schedule next task when subtask completes
  → Merge results and generate report when all done
```

---

## 技术栈 / Tech Stack

| 组件 / Component | 技术 / Technology |
|---|---|
| 运行时 / Runtime | Node.js 20+ (ESM) |
| 语言 / Language | TypeScript (strict mode) |
| HTTP 服务 / HTTP Server | Fastify |
| 数据库 / Database | SQLite (better-sqlite3) |
| 测试 / Testing | Vitest |
| CLI 框架 / CLI Framework | Commander.js |
| 通信协议 / Protocol | Stream-JSON over stdin/stdout |

---

## 测试 / Testing

```bash
# 运行所有单元测试
# Run all unit tests
npm test

# 运行 E2E 集成测试
# Run E2E integration test
./test-e2e-full.sh
```

---

## 数据存储 / Data Storage

```
~/.cc-orchestrator/
├── config.json          # 配置 / Configuration
├── orchestrator.db      # SQLite 数据库 / SQLite database
├── goals/               # 目标元数据 / Goal metadata
├── workers/             # Worker 状态 / Worker states
├── transcripts/         # 完整对话记录 / Full conversation logs
└── reports/             # Markdown 报告 / Markdown reports
```

---

## 许可证 / License

MIT

---

<p align="center">
  Made with ❤️ for AI-assisted software engineering
</p>

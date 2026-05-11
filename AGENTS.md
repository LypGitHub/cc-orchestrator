# AGENTS.md -- 给 codex / aider / cursor 等 agent 的入口说明

本仓库是一个智能 Claude Code 进程管理器，**权威文档在 [`SKILL.md`](./SKILL.md)**。任何涉及"管理多个 Claude 进程 / 并行执行任务 / 监控 CPU 自动调度 / 角色分配"的请求，都先完整读 `SKILL.md` 再动手。

## 一分钟索引

- **主入口 CLI**：`cc-orch start` 启动服务，`cc-orch run "任务描述" --dir <工作目录>` 提交目标
- **核心能力**：目标自动拆解 → 角色分配 → CPU 感知调度 → 并行执行 → 结果合并
- **8 个预定义角色**：backend-engineer, frontend-engineer, devops-engineer, qa-engineer, architect, code-reviewer, debugger, general
- **资源管理**：CPU>90% 自动暂停低优先级 Worker (SIGSTOP)，CPU 下降后恢复 (SIGCONT)
- **通信协议**：`--print` + `--input-format stream-json --output-format stream-json --verbose`
- **数据存储**：SQLite (`~/.cc-orchestrator/orchestrator.db`) + Markdown 报告 (`~/.cc-orchestrator/reports/`)

## 调用规范

1. **先启动服务**：`cc-orch start [--port 17890 --max-workers 4]`
2. **再提交目标**：`cc-orch run "实现用户认证系统" --dir ~/works/project --workers 3`
3. **查看状态**：`cc-orch system`, `cc-orch workers`, `cc-orch status <goal-id>`
4. **管理进程**：`cc-orch pause <worker-id>`, `cc-orch resume <worker-id>`, `cc-orch cancel <goal-id>`

## 环境要求

- Node.js 20+
- `claude` CLI 已安装且可执行
- macOS / Linux（Windows 暂不支持 SIGSTOP/SIGCONT）

## 凭据

- 无需额外 API Key，使用 Claude CLI 已有的认证
- 可选：配置 `~/.cc-orchestrator/config.json` 调整端口、并发数、CPU 阈值

## 不要做的事

- 不要直接 spawn `claude` 进程而不经过 Orchestrator（会失去监控和结果收集）
- 不要在 Worker 运行时删除 `~/.cc-orchestrator/` 目录

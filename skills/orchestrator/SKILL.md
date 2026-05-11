# Skill: Coding Orchestrator

## 描述

智能管理多个 Claude Code 进程，自动拆解目标、分配角色、调度执行、监控系统资源。

## 安装

```bash
# 1. 确保 cc-orchestrator 已安装
npm install
npm run build

# 2. 创建符号链接到 skills 目录
ln -s /path/to/cc-orchestrator ~/.claude/skills/orchestrator
```

## 使用

### 启动服务

```bash
cc-orch start
# 或指定端口
cc-orch start --port 17890 --max-workers 4
```

### 提交目标（自然语言）

```
/orchestrator run "实现用户认证系统，包含登录、注册、JWT token" --dir ~/works/my-project --workers 3
```

### 查看状态

```
/orchestrator status goal_xxx
/orchestrator system
/orchestrator workers
```

### 管理进程

```
/orchestrator pause worker_001
/orchestrator resume worker_001
/orchestrator cancel goal_xxx
```

## 工作流程

1. 用户描述目标（自然语言）
2. Orchestrator 自动拆解为子任务
3. 根据 CPU 状态创建适当数量的 Worker
4. 为每个 Worker 分配角色和任务
5. 实时跟踪执行进度（stream-json 协议）
6. CPU 紧张时自动暂停低优先级 Worker
7. 任务完成后合并结果、生成报告

## 角色系统

每个 Worker 有预定义角色：
- `backend-engineer` — API、数据库、服务端逻辑
- `frontend-engineer` — UI 组件、页面、交互
- `devops-engineer` — 部署、Docker、CI/CD
- `qa-engineer` — 测试用例、Bug 修复验证
- `architect` — 架构设计、重构方案
- `code-reviewer` — 代码审查、安全审计
- `debugger` — Bug 定位、根因分析
- `general` — 通用开发任务

## 资源管理

- **CPU < 60% + 待处理任务**: 创建新 Worker
- **CPU > 80%**: 停止创建新 Worker
- **CPU > 90%**: 自动暂停优先级最低的 Worker (SIGSTOP)
- **CPU 下降**: 自动恢复暂停的 Worker (SIGCONT)

## 配置

编辑 `~/.cc-orchestrator/config.json`:

```json
{
  "port": 17890,
  "maxWorkers": 4,
  "cpuThresholdHigh": 80,
  "cpuThresholdCritical": 90,
  "monitorIntervalMs": 5000
}
```

## 数据

- 数据库: `~/.cc-orchestrator/orchestrator.db`
- 报告: `~/.cc-orchestrator/reports/`
- Transcript: `~/.cc-orchestrator/transcripts/`

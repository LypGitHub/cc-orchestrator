#!/bin/bash

##############################################################################
# CC Orchestrator -- Claude Code / OpenClaw / Codex Skill 安装脚本
#
# 把当前仓库内容拷贝到目标 skill 目录并安装 Node.js 依赖。
# 同时构建并安装 OpenClaw 插件（当 target 为 openclaw 或 auto 时）。
#
# 用法：bash install_as_skill.sh [--target auto|claude|codex|openclaw]
##############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info()    { echo -e "${BLUE}(i)  $1${NC}"; }
print_success() { echo -e "${GREEN}[OK] $1${NC}"; }
print_warning() { echo -e "${YELLOW}(!)  $1${NC}"; }
print_error()   { echo -e "${RED}[X] $1${NC}"; }
print_header()  { echo ""; echo "========================================"; echo "$1"; echo "========================================"; echo ""; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

TARGET="auto"

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --target)
                TARGET="${2:-}"
                shift 2
                ;;
            --target=*)
                TARGET="${1#*=}"
                shift
                ;;
            *)
                print_error "未知参数: $1"
                echo "用法: bash install_as_skill.sh [--target auto|claude|codex|openclaw]"
                exit 1
                ;;
        esac
    done
}

resolve_install_target() {
    case "$TARGET" in
        auto)
            if [ -n "${OPENCLAW_HOME:-}" ]; then
                echo "openclaw"
            elif [ -n "${CODEX_HOME:-}" ]; then
                echo "codex"
            elif [ -d "$HOME/.claude" ]; then
                echo "claude"
            elif [ -d "$HOME/.codex" ]; then
                echo "codex"
            else
                echo "claude"
            fi
            ;;
        claude|codex|openclaw)
            echo "$TARGET"
            ;;
        *)
            print_error "不支持的 target: $TARGET"
            echo "可选值: auto | claude | codex | openclaw"
            exit 1
            ;;
    esac
}

resolve_skill_dir() {
    case "$1" in
        claude)
            echo "$HOME/.claude/skills/cc-orchestrator"
            ;;
        codex)
            echo "${CODEX_HOME:-$HOME/.codex}/skills/cc-orchestrator"
            ;;
        openclaw)
            echo "$HOME/.claude/skills/cc-orchestrator"
            ;;
    esac
}

resolve_agent_label() {
    case "$1" in
        claude)
            echo "Claude Code"
            ;;
        codex)
            echo "Codex"
            ;;
        openclaw)
            echo "OpenClaw"
            ;;
    esac
}

# -- OpenClaw Plugin Installation --------------------------------------------

install_openclaw_plugin() {
    local SCRIPT_DIR="$1"
    local PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/lypgithub/cc-orchestrator"
    local OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"

    print_header "OpenClaw 插件安装"

    print_info "OpenClaw 插件目录: $PLUGIN_DIR"

    if [ -d "$PLUGIN_DIR" ]; then
        print_warning "插件目录已存在，覆盖..."
        rm -rf "$PLUGIN_DIR"
    fi

    mkdir -p "$PLUGIN_DIR"
    print_success "插件目录已创建"

    print_info "复制 OpenClaw 插件文件..."
    rsync -a \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='.DS_Store' \
        "$SCRIPT_DIR/openclaw-plugin/" "$PLUGIN_DIR/"
    print_success "文件复制完成"

    print_info "安装 OpenClaw 插件依赖..."
    cd "$PLUGIN_DIR"
    npm install
    print_success "依赖安装完成"

    print_info "编译 OpenClaw 插件..."
    npm run build
    print_success "编译完成"

    # -- Auto-configure ~/.openclaw/openclaw.json -----------------------------
    if [ -f "$OPENCLAW_CONFIG" ]; then
        print_info "配置 OpenClaw 插件注册..."

        # Use Node.js to safely modify JSON
        node -e "
const fs = require('fs');
const path = '$OPENCLAW_CONFIG';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));

// Add to plugins.allow if not present
if (!config.plugins) config.plugins = { enabled: true, allow: [], entries: {} };
if (!config.plugins.allow) config.plugins.allow = [];
if (!config.plugins.allow.includes('cc-orchestrator')) {
    config.plugins.allow.push('cc-orchestrator');
    console.log('Added cc-orchestrator to plugins.allow');
}

// Add to plugins.entries if not present
if (!config.plugins.entries) config.plugins.entries = {};
if (!config.plugins.entries['cc-orchestrator']) {
    config.plugins.entries['cc-orchestrator'] = { enabled: true };
    console.log('Added cc-orchestrator to plugins.entries');
}

fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\\n');
console.log('OpenClaw config updated successfully');
" && print_success "OpenClaw 配置已更新" || print_warning "OpenClaw 配置更新失败，请手动添加"
    else
        print_warning "未找到 OpenClaw 配置文件: $OPENCLAW_CONFIG"
        print_info "请手动在 ~/.openclaw/openclaw.json 中添加:"
        print_info '  plugins.allow: [..., "cc-orchestrator"]'
        print_info '  plugins.entries.cc-orchestrator: { "enabled": true }'
    fi

    # -- Refresh OpenClaw plugin registry ----------------------------------
    if command_exists openclaw; then
        print_info "刷新 OpenClaw 插件注册表..."
        openclaw plugins registry --refresh 2>/dev/null || print_warning "openclaw plugins registry --refresh 失败，请手动运行"
        print_success "插件注册表已刷新"

        print_info "重启 OpenClaw Gateway..."
        launchctl unload "$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist" 2>/dev/null
        sleep 2
        launchctl load "$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist" 2>/dev/null
        sleep 3
        print_success "Gateway 已重启"
    else
        print_warning "未找到 openclaw 命令，跳过注册表刷新"
    fi

    print_success "OpenClaw 插件安装完成"
}

# -- Main ----------------------------------------------------------------------

main() {
    parse_args "$@"

    print_header "CC Orchestrator -- 安装"

    INSTALL_TARGET="$(resolve_install_target)"
    SKILL_DIR="$(resolve_skill_dir "$INSTALL_TARGET")"
    AGENT_LABEL="$(resolve_agent_label "$INSTALL_TARGET")"

    print_info "目标 agent: $AGENT_LABEL"
    print_info "目标目录: $SKILL_DIR"

    if [ -d "$SKILL_DIR" ]; then
        print_warning "Skill 目录已存在: $SKILL_DIR"
        read -p "是否覆盖？(y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "取消"
            exit 0
        fi
        rm -rf "$SKILL_DIR"
    fi

    print_info "创建 Skill 目录..."
    mkdir -p "$SKILL_DIR"
    print_success "目录已创建"

    print_info "复制项目文件..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # 拷贝核心文件，排除 .git / node_modules / dist / test dirs
    rsync -a \
        --exclude='.git' \
        --exclude='node_modules' \
        --exclude='dist' \
        --exclude='test-*' \
        --exclude='.DS_Store' \
        "$SCRIPT_DIR/" "$SKILL_DIR/"

    print_success "文件复制完成"

    print_info "检查 Node.js 环境..."
    if ! command_exists node; then
        print_error "未找到 node，请先安装 Node.js 20+"
        exit 1
    fi
    NODE_VERSION=$(node --version | sed 's/v//')
    print_success "Node.js: $NODE_VERSION"

    print_info "安装依赖..."
    cd "$SKILL_DIR"
    npm install
    print_success "依赖安装完成"

    print_info "编译 TypeScript..."
    npm run build
    print_success "编译完成"

    # -- Install launchd Service (auto-start on boot) ---------------------------
    print_header "系统服务安装"
    print_info "安装 cc-orch 为后台常驻服务..."
    if [ -f "$SCRIPT_DIR/service/install-service.sh" ]; then
        bash "$SCRIPT_DIR/service/install-service.sh"
        print_success "服务已安装并启动"
    else
        print_warning "服务安装脚本未找到，跳过"
    fi

    # -- OpenClaw Plugin (when target is openclaw or auto with OpenClaw detected) --
    if [ "$INSTALL_TARGET" = "openclaw" ] || [ -n "${OPENCLAW_HOME:-}" ] || [ -d "$HOME/.openclaw" ]; then
        install_openclaw_plugin "$SCRIPT_DIR"
    fi

    print_header "安装完成"

    print_success "已装到 $SKILL_DIR"
    echo ""
    print_info "服务状态:"
    print_info "  cc-orch 服务已作为后台常驻进程运行"
    print_info "  API: http://127.0.0.1:17890"
    print_info "  日志: ~/.cc-orchestrator/logs/"
    echo ""
    print_info "使用方法:"
    print_info "  提交目标:  cc-orch run \"实现用户认证\" --dir ~/works/project"
    print_info "  查看状态:  cc-orch system"
    print_info "  停止服务:  launchctl unload ~/Library/LaunchAgents/ai.cc-orchestrator.gateway.plist"
    print_info "  启动服务:  launchctl load   ~/Library/LaunchAgents/ai.cc-orchestrator.gateway.plist"

    if [ "$INSTALL_TARGET" = "openclaw" ] || [ -d "$HOME/.openclaw" ]; then
        echo ""
        print_info "OpenClaw 插件命令："
        print_info "  /cc-orch-run \"实现用户认证\" --dir ~/works/project"
        print_info "  /cc-orch-list      列出所有目标"
        print_info "  /cc-orch-status    查看目标状态"
        print_info "  /cc-orch-workers   查看所有 Worker"
        print_info "  /cc-orch-system    查看系统资源"
        print_info "  /cc-orch-help      显示帮助"
    fi

    echo ""
    print_info "冒烟测试:"
    print_info "  cc-orch run \"echo hello\" --dir /tmp"
    echo ""
}

trap 'print_error "安装过程出错"; exit 1' ERR

main "$@"

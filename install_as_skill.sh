#!/bin/bash

##############################################################################
# CC Orchestrator -- Claude Code / OpenClaw Skill 安装脚本
#
# 把当前仓库内容拷贝到目标 skill 目录并安装 Node.js 依赖。
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
            echo "${OPENCLAW_HOME:-$HOME/skills}/cc-orchestrator"
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

    print_header "安装完成"

    print_success "已装到 $SKILL_DIR"
    echo ""
    print_info "下一步："
    print_info "  1. 确保 claude CLI 已安装:  claude --version"
    print_info "  2. 启动服务:  cc-orch start"
    print_info "  3. 提交目标:  cc-orch run \"实现用户认证\" --dir ~/works/project"
    print_info "  4. 查看状态:  cc-orch system"
    echo ""
    print_info "冒烟测试（可选）："
    print_info "  cd $SKILL_DIR"
    print_info "  ./bin/cc-orch start &"
    print_info "  ./bin/cc-orch run \"echo hello\" --dir /tmp"
    echo ""
}

trap 'print_error "安装过程出错"; exit 1' ERR

main "$@"

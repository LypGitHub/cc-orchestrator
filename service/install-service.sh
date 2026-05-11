#!/bin/bash
###############################################################################
# CC Orchestrator -- macOS launchd Service Installer
#
# Installs cc-orchestrator as a system daemon that auto-starts on boot.
###############################################################################

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
USER_HOME="$HOME"
DATA_DIR="${CC_ORCH_DATA_DIR:-$HOME/.cc-orchestrator}"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/ai.cc-orchestrator.gateway.plist"

# -- Resolve node path --------------------------------------------------------
resolve_node_path() {
    if command -v node >/dev/null 2>&1; then
        command -v node
        return
    fi
    for path in \
        /opt/homebrew/bin/node \
        /usr/local/bin/node \
        "$HOME/.nvm/versions/node/v22.22.0/bin/node" \
        "$HOME/.nvm/versions/node/*/bin/node"
    do
        # shellcheck disable=SC2086
        for resolved in $path; do
            if [ -x "$resolved" ]; then
                echo "$resolved"
                return
            fi
        done
    done
    echo ""
}

NODE_PATH="$(resolve_node_path)"
if [ -z "$NODE_PATH" ]; then
    print_error "Node.js not found. Please install Node.js 20+."
    exit 1
fi
print_info "Node.js: $NODE_PATH"

# -- Ensure data directory and logs -------------------------------------------
mkdir -p "$DATA_DIR/logs"

# -- Generate launchd plist ---------------------------------------------------
print_info "Generating launchd plist..."

PLIST_TEMPLATE="$SCRIPT_DIR/ai.cc-orchestrator.gateway.plist"

# Substitute placeholders
sed \
    -e "s|CC_ORCH_DIR|$PROJECT_DIR|g" \
    -e "s|USER_HOME|$USER_HOME|g" \
    -e "s|CC_ORCH_DATA_DIR_VALUE|$DATA_DIR|g" \
    -e "s|NODE_PATH_PLACEHOLDER|$NODE_PATH|g" \
    "$PLIST_TEMPLATE" > "$LAUNCHD_PLIST"

print_success "Plist generated: $LAUNCHD_PLIST"

# -- Unload existing if present -----------------------------------------------
if launchctl list | grep -q "ai.cc-orchestrator.gateway"; then
    print_info "Stopping existing service..."
    launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
    sleep 1
fi

# -- Load and start service ---------------------------------------------------
print_info "Loading service..."
launchctl load "$LAUNCHD_PLIST"
sleep 2

# -- Verify -------------------------------------------------------------------
if launchctl list | grep -q "ai.cc-orchestrator.gateway"; then
    PID=$(launchctl list | grep "ai.cc-orchestrator.gateway" | awk '{print $1}')
    print_success "Service started! PID: $PID"
    print_info "Logs: $DATA_DIR/logs/"
    print_info "API:  http://127.0.0.1:17890"
    print_info ""
    print_info "Commands:"
    print_info "  launchctl unload $LAUNCHD_PLIST   # Stop"
    print_info "  launchctl load   $LAUNCHD_PLIST   # Start"
    print_info "  tail -f $DATA_DIR/logs/gateway.log  # View logs"
else
    print_error "Service failed to start. Check logs:"
    print_error "  $DATA_DIR/logs/gateway.err.log"
    exit 1
fi

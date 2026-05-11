#!/bin/bash
# Worker Output Verification Test

set -e

echo "========================================"
echo "Worker Output Verification Test"
echo "========================================"

PROJECT_DIR="/Users/liyipeng/Desktop/works/cc-orchestrator"
cd "$PROJECT_DIR"

TEST_DIR="$(mktemp -d /tmp/cc-orch-worker-test-XXXXXX)"
export CC_ORCH_DATA_DIR="$TEST_DIR"

cleanup() {
    echo ""
    echo "[Cleanup] Stopping server..."
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 1
    echo "--- Server stderr log ---"
    tail -30 "$TEST_DIR/server-stderr.log" 2>/dev/null || echo "No server stderr"
    echo ""
    echo "--- Server stdout log ---"
    tail -30 "$TEST_DIR/server-stdout.log" 2>/dev/null || echo "No server stdout"
    echo ""
    rm -rf "$TEST_DIR"
    echo "Cleanup done."
}
trap cleanup EXIT

echo "[1/5] Starting server on port 17998..."
node dist/cli.js start --port 17998 --max-workers 2 > "$TEST_DIR/server-stdout.log" 2> "$TEST_DIR/server-stderr.log" &
SERVER_PID=$!
sleep 2

echo "[2/5] Creating a simple test goal..."
GOAL_RESPONSE=$(curl -s -X POST http://127.0.0.1:17998/api/v1/goals \
    -H "Content-Type: application/json" \
    -d '{"description":"Write hello to a file called test-output.txt","workDir":"/tmp","priority":"high"}')
GOAL_ID=$(echo "$GOAL_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.goal.id)")
echo "  Goal: $GOAL_ID"

echo "[3/5] Waiting for worker spawn and execution (15s)..."
sleep 15

echo "[4/5] Checking worker processes..."
WORKERS=$(curl -s http://127.0.0.1:17998/api/v1/workers)
echo "$WORKERS" | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('Worker count:', d.workers.length);
d.workers.forEach(w => {
  console.log('  ', w.id, '-', w.status, 'role=', w.role, 'pid=', w.pid);
});
"

echo "[5/5] Checking goal status..."
GOAL_STATUS=$(curl -s "http://127.0.0.1:17998/api/v1/goals/$GOAL_ID")
echo "$GOAL_STATUS" | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('Goal status:', d.goal.status);
console.log('Subtasks:', d.subTasks.length);
d.subTasks.forEach(st => {
  console.log('  ', st.id, '-', st.status, 'role=', st.role);
  if (st.result) {
    console.log('    result.success:', st.result.success);
    console.log('    result.output:', (st.result.output || '').slice(0, 100));
    console.log('    result.error:', st.result.error);
  }
});
"

echo ""
echo "========================================"
echo "Worker Output Test Complete"
echo "========================================"

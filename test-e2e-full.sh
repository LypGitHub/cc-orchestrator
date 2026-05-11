#!/bin/bash
# Full End-to-End Integration Test

set -e

echo "========================================"
echo "Full E2E Test with Real Worker Execution"
echo "========================================"

PROJECT_DIR="/Users/liyipeng/Desktop/works/cc-orchestrator"
cd "$PROJECT_DIR"

TEST_DIR="$(mktemp -d /tmp/cc-orch-e2e-full-XXXXXX)"
export CC_ORCH_DATA_DIR="$TEST_DIR"

cleanup() {
    echo ""
    echo "[Cleanup] Stopping server..."
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 1
    echo "--- Server stdout ---"
    tail -40 "$TEST_DIR/server.log" 2>/dev/null || echo "No log"
    rm -rf "$TEST_DIR"
    echo "Cleanup done."
}
trap cleanup EXIT

echo "[1/6] Starting server..."
node dist/cli.js start --port 17997 --max-workers 1 > "$TEST_DIR/server.log" 2>&1 &
SERVER_PID=$!
sleep 2

echo "[2/6] Submitting a real task..."
GOAL_RESPONSE=$(curl -s -X POST http://127.0.0.1:17997/api/v1/goals \
    -H "Content-Type: application/json" \
    -d '{"description":"Use Bash to write hello world to /tmp/cc-orch-test-output.txt","workDir":"/tmp","priority":"high"}')
GOAL_ID=$(echo "$GOAL_RESPONSE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.goal.id)")
echo "  Goal: $GOAL_ID"

echo "[3/6] Waiting for task execution (25s)..."
sleep 25

echo "[4/6] Checking results..."
GOAL_STATUS=$(curl -s "http://127.0.0.1:17997/api/v1/goals/$GOAL_ID")
echo "$GOAL_STATUS" | node -e "
const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('Goal status:', d.goal.status);
console.log('Subtasks:', d.subTasks.length);
d.subTasks.forEach(st => {
  console.log('  Subtask:', st.id, '-', st.status, 'role=', st.role);
  if (st.result) {
    console.log('    success:', st.result.success);
    console.log('    output:', (st.result.output || '').slice(0, 100));
    console.log('    files:', st.result.filesModified);
  }
});
console.log('Workers:', d.workers.length);
d.workers.forEach(w => {
  console.log('  Worker:', w.id, 'status=', w.status, 'turns=', w.stats.turnsUsed);
});
"

echo "[5/6] Checking file output..."
if [ -f /tmp/cc-orch-test-output.txt ]; then
    echo "  File exists! Content:"
    cat /tmp/cc-orch-test-output.txt
    rm -f /tmp/cc-orch-test-output.txt
else
    echo "  File NOT found"
fi

echo "[6/6] Checking transcripts..."
sqlite3 "$TEST_DIR/orchestrator.db" "SELECT message_type, COUNT(*) FROM transcripts GROUP BY message_type;" 2>/dev/null || echo "No transcript data"

echo ""
echo "========================================"
echo "Full E2E Test Complete"
echo "========================================"

#!/bin/bash
# Start the abadge dev stack (API + Web, excluding Mintlify docs).
# Waits until /health returns ok before exiting.
#
# Usage: bash .claude/skills/live-test-matrix/scripts/start-stack.sh

set -euo pipefail

# Background the dev stack so we can wait for /health and return.
LOG=/tmp/abadge-devstack.log
echo "Starting dev stack (logs: $LOG)..."
nohup doppler run -- turbo dev --filter='!@abadge/docs' > "$LOG" 2>&1 &
PID=$!

# Wait for /health to come up. Cap at 90s — wrangler startup can be slow.
DEADLINE=$(( $(date +%s) + 90 ))
until curl -s http://localhost:8787/health 2>/dev/null | grep -q '"ok"'; do
  if [ $(date +%s) -gt $DEADLINE ]; then
    echo "ERROR: API never came up within 90s. Last log lines:" >&2
    tail -20 "$LOG" >&2
    kill $PID 2>/dev/null || true
    exit 1
  fi
  sleep 2
done

echo "API ready at http://localhost:8787"
echo "Web at http://localhost:3000"
echo "Stack PID: $PID"
echo "$PID" > /tmp/abadge-devstack.pid

#!/bin/bash
# Stop the dev stack, restore CLI config, optionally clean test DB rows.
#
# Usage: bash .claude/skills/live-test-matrix/scripts/teardown.sh [--clean-db]

set -uo pipefail

# Stop dev stack
pkill -f "turbo dev" 2>/dev/null || true
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
echo "Stopped dev stack"

# Restore CLI config
if [ -f ~/.abadge/config.json.bak.pentest ]; then
  mv ~/.abadge/config.json.bak.pentest ~/.abadge/config.json
  echo "Restored ~/.abadge/config.json"
fi

# Optional: truncate test data
if [ "${1:-}" = "--clean-db" ]; then
  DB="${ABADGE_TEST_DATABASE_URL:-postgresql://abadge:abadge@localhost:5432/abadge}"
  echo "Cleaning test users (cascades to org/profile/item/agent/permission/audit)..."
  psql "$DB" -c "DELETE FROM \"user\" WHERE email LIKE 'pentest-%@test.local';" > /dev/null
  echo "Cleaned test data"
fi

# Clean up scratch files
rm -f /tmp/abadge-devstack.pid /tmp/abadge-devstack.log /tmp/bearer.txt 2>/dev/null || true
echo "Cleaned up scratch files"

#!/bin/bash
# Bootstrap a verified test user against the running dev stack.
# Prints the bearer token to stdout (capture into a file or env var).
#
# Usage: bash .claude/skills/live-test-matrix/scripts/bootstrap-test-user.sh > /tmp/bearer.txt

set -euo pipefail

API="${ABADGE_API_URL:-http://localhost:8787}"
DB="${ABADGE_TEST_DATABASE_URL:-postgresql://abadge:abadge@localhost:5432/abadge}"

EMAIL="pentest-${RANDOM}-$(date +%s)@test.local"
PW="TestPassword123!"

# 1. Sign up
curl -s -X POST "$API/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"name\":\"PenTest\"}" > /dev/null

# 2. Bypass email verification (Better Auth's bearer plugin requires it).
psql "$DB" \
  -c "UPDATE \"user\" SET email_verified=true WHERE email='$EMAIL';" > /dev/null

# 3. Sign in and capture the set-auth-token header value.
SESSION=$(curl -sv -X POST "$API/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" 2>&1 \
  | grep "set-auth-token:" | sed 's/.*set-auth-token: //' | tr -d '\r')

if [ -z "$SESSION" ]; then
  echo "ERROR: failed to capture set-auth-token from sign-in" >&2
  exit 1
fi

# Print bearer to stdout. Stderr gets a hint about which user this is.
echo "$SESSION"
echo "Bootstrapped user: $EMAIL" >&2

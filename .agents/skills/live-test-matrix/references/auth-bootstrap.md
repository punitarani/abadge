# Auth bootstrap

Get a real Better Auth session bearer token in 4 commands. Use this for any test that needs to drive the API as a user.

## The recipe

```bash
EMAIL="pentest-${RANDOM}@test.local"
PW="TestPassword123!"

# 1. Sign up
curl -s -X POST http://localhost:8787/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"name\":\"PenTest\"}" > /dev/null

# 2. Bypass email verification (Better Auth's bearer plugin requires verified email)
psql postgresql://abadge:abadge@localhost:5432/abadge \
  -c "UPDATE \"user\" SET email_verified=true WHERE email='$EMAIL';" > /dev/null

# 3. Sign in and capture set-auth-token header
SESSION=$(curl -sv -X POST http://localhost:8787/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" 2>&1 \
  | grep "set-auth-token:" | sed 's/.*set-auth-token: //' | tr -d '\r')
echo "$SESSION"
```

The `set-auth-token` header value IS the bearer. Use it as `Authorization: Bearer $SESSION`.

The DB UPDATE bypassing email verification is safe in dev because:

- The email is fictional (`pentest-N@test.local`)
- The dev API has no real email-out (Mailpit dev binding)
- Bypassing this in production would still require DB write access, which is itself a complete system compromise

## Token format

Better Auth bearer tokens look like `<sessionId>.<HMAC>` — a session ID, a literal `.`, and an HMAC signature. They're URL-unsafe (contain `+`, `/`, `=`) so be careful when passing through env vars and URL encodings — keep them as plain bash strings, don't try to URL-encode unless you're putting them in a query string.

## Agent bearer tokens (different path)

For agent-side endpoints (`access.reveal`, `access.mount`, `items.listForAgent`), you need an agent bearer, not a user bearer. The simplest way:

```bash
AGENT_RESP=$(curl -s -X POST "http://localhost:8787/trpc/agents.create" \
  -H "Authorization: Bearer $SESSION" \
  -H "X-Abadge-Org-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-agent","kind":"remote","authMethod":"legacy_api_key"}')
AGENT_KEY=$(echo "$AGENT_RESP" | jq -r '.result.data.apiKey')
```

`apiKey` is shown ONCE on creation — it's the bearer. Agent bearers start with `abl_` (local) or `abg_` (remote) prefix per AGENTS.md. Use it the same way: `Authorization: Bearer $AGENT_KEY`.

For pentests that need a public-key-session agent, the lifecycle is more complex (challenge → sign → exchange) — see `auth.createChallenge` / `auth.exchangeSession` in `packages/trpc/src/server/routers/auth.ts`. Stick with `legacy_api_key` for matrix testing unless you specifically need to test the keypair flow.

## Cleanup

Test users have a sentinel-prefix email, so cleanup is one query:

```bash
psql postgresql://abadge:abadge@localhost:5432/abadge \
  -c "DELETE FROM \"user\" WHERE email LIKE 'pentest-%@test.local';" > /dev/null
```

This cascades to `session`, `account`, `member`, and any orgs/items/agents they created.

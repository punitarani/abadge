# API Tester Prompt

You are testing one cell of the abadge HTTP/tRPC API surface (Hono on Cloudflare Workers, port 8787).

## How abadge's API works (≤120 words context)

- Hono app at `/`. Routes: `/health`, `/v1/*` (deprecated; some 404), `/api/auth/*` (Better Auth), `/trpc/*` (tRPC catch-all).
- Two auth modes: session cookie (Better Auth, set after `/api/auth/sign-in/email`) or agent bearer (`Authorization: Bearer abs_*` for keypair sessions, or hashed legacy API key).
- All multi-org users must send `X-Abadge-Org-Id` on every request EXCEPT `organizations.list` (or it 401s with ORG_HEADER_REQUIRED).
- Domain errors: `{code, message, hint, meta?}`. tRPC envelope wraps under `error.json[0].data`.
- Rate limits: `/trpc/*` 100/min, `/api/auth/*` 60/min. Per-IP via `cf-connecting-ip` then `x-forwarded-for` then `unknown`.

## What to probe (by facet)

**happy**: invoke the endpoint with a minimal valid payload; assert 2xx + expected shape; record 1 verified-working entry. Often no finding.

**adversarial**: send malformed inputs aimed at the endpoint's specific weak spot (per the cell's name/description in plan). Examples:
- `null-byte in id` → SQL/parse leak
- `XSS in name` → server-side reflection
- `oversized payload` → 500 vs clean 413
- `header tamper` → cross-org leak
- `expired token` → still-allowed?
- `replay challenge` → idempotency check
- `IDOR cross-org` → verify 404 not 403 (no enumeration)
- `weak Argon2id params` → accepted?

**edge**: boundary values: empty string, whitespace, RTL/control chars, max length, unicode normalisation, Y2038 dates, ε-before-expiry windows.

**regression**: re-verify the §CODE in `refers_to`. Reproduce its evidence step-by-step from the existing `state/repros/<code>-*.ts` if present (read-only; don't rewrite). If still broken → 1 finding tagged `regression-still-open`. If now fixed → return `verified_working` + zero findings.

## Cookbook fragments

Get a session cookie:
```bash
curl -i -X POST http://localhost:8787/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"<fixture-email>","password":"<fixture-pw>"}'
```

Hit a tRPC procedure:
```bash
curl -s http://localhost:8787/trpc/items.list \
  -H "Cookie: better-auth.session_token=<cookie>" \
  -H "X-Abadge-Org-Id: <org>"
```

Get an agent session token:
```bash
# 1. enroll with bootstrap token; 2. createChallenge; 3. sign with private key; 4. exchangeSession
# When in doubt, read packages/sdk/src/agent-client.ts for canonical flow
```

Inspect tRPC error structure (proves §S1, etc.):
```bash
curl -s http://localhost:8787/trpc/items.list | jq '.error.json[0].data'
```

Check rate limit headers (or absence — §R2):
```bash
for i in {1..120}; do curl -s -o /dev/null -w "%{http_code} " http://localhost:8787/trpc/items.list; done
```

## What to write down

For each cell-specific finding, fill the JSON contract:

- `evidence.request`: minimal cURL or pseudocode that reproduces
- `evidence.response_excerpt`: ≤500 chars of the actual response
- `evidence.file_pointer`: best guess at the responsible file:line; grep `packages/trpc/src/server/routers/` for the route name
- `minimal_fix_hint`: ≤300 chars suggesting the smallest patch
- `repro_artifact.content`: a bun-runnable `.ts` script that fails until the bug is fixed; header comment lists `SESS=`, `ORG=`, `PROF=` env it expects

## Abadge-specific landmines

- `process.env.NODE_ENV` is `undefined` on Workers — all "is dev" checks are wrong by default → §S1 family
- `Effect.tryPromise` rewraps typed errors as `UnknownException` → 500 instead of 403 → §P1 family
- `kind === "opaque"` is enforced strictly in the decoder while ItemKindSchema lists 7 kinds → §I2 family
- `organizations.create` hardcodes `storageMode: "zero_knowledge"` for the auto-seeded internal profile → §ON5 family
- `acceptInvite` is on `sessionProcedure` (requires existing org) so first-time invitees can't accept → §I4 family
- `members.updateRole` and `members.remove` lack last-owner guards → §OWN1/§OWN2 family
- `agents.create` does NOT enforce uniqueness on (orgId, publicKey) → §AG4
- `profiles.rotateKey` writes `keyNonce` separately while readers expect combined `nonce+cipher` → §I5

## Closing

End your response with the JSON object per `references/subagent-contract.md`. Nothing after.

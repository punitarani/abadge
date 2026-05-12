---
name: live-test-matrix
description: Define and execute a comprehensive end-to-end test matrix for an abadge feature against a live local stack — not just code-level integration tests, but real CLI binary invocations, real Hono+tRPC API calls on the wrangler emulator, real Better Auth sessions, real agent bearer tokens, and real Postgres state verification. Categorize the matrix into happy paths, edge cases, adversarial scenarios, and security pentests (≥3 variations per category), track every row in a `TESTING.md` running log, and execute via a generated bash harness. Use this skill whenever the user wants thorough manual or end-to-end testing of a feature, asks to "pentest" or "adversarially test" something, says "actually test it not just code tests" or "manually run the CLI against this", asks for a test matrix with multiple categories, or wants to verify a feature works against a real running stack. Prefer this skill over ad-hoc one-off testing scripts whenever the user wants more than three or four assertions, even if they don't explicitly say "matrix" or "pentest".
---

# live-test-matrix

This skill captures a battle-tested workflow for comprehensively testing an abadge feature by exercising the running dev stack — real Postgres, real Hono+tRPC API on the wrangler Cloudflare-Worker emulator, real Better Auth bearer-token sessions, real agent legacy-API-key bearer tokens, real CLI binary, and real DB state verification.

The methodology has four parts:

1. **Test plan**: enumerate every test as a row in `TESTING.md`, organized into four categories (happy / edge / adversarial / pentest), with **at least 3 variations per scenario class**.
2. **Live stack**: bring up the dev stack and bootstrap a real authenticated session.
3. **Harness**: write a bash script that hits the running API + CLI binary with assertions for each row.
4. **Verify**: check pass/fail state, audit-log invariants, and tear down cleanly.

Why a matrix and not just a single happy-path test? Because real bugs hide in the corners. The cross-profile AAD-tampering finding from PR #119 (where a DB-write attacker rebinding `profile_id` correctly fails to decrypt) was only discovered because the matrix forced us to write a sanity test that tripped over the AAD invariant. Single-shot testing finds zero of those.

## When to use

Trigger this skill when the user wants any of:

- "pentest this feature", "adversarial test", "security test"
- "manually run the CLI", "actually test it not just code tests"
- "test this thoroughly" (when "thoroughly" implies more than ~3 assertions)
- "happy path, edge cases, and adversarial" (or any subset)
- A test matrix or test plan against a live stack
- End-to-end coverage that exercises the wire format the CLI/web/MCP actually use

Do **not** use for:

- Pure code-level integration tests that belong in `packages/*/src/**/__tests__/` (those are `bun test` + `seedX` helpers; no live stack)
- Static gates (typecheck, lint, format) — those run via `bun run typecheck` etc.
- Trivial smoke checks ("does the API start?") that don't benefit from category structure

## The four test categories

Every matrix gets ≥3 variations per category. Three is the floor, not the target — add more when the feature has more dimensions to cover.

### H — Happy paths
The flows the feature is built for. Cover the dimensions of input space.

For permissions: `local + SM + 1 cap`, `local + SM + 3-cap batch`, `remote + SM + reveal_plaintext`. Three dimensions: agent locality, storage mode, batch size.

### E — Edge cases
Boundary conditions, unusual but valid inputs, multi-X-within-Y combinations, list-filter compositions, expiry edges, re-grant-after-revoke.

For permissions: `3-cap batch with shared expiry`, `list({agentId, itemId}) AND-combined`, `re-grant the revoked cap (no PERMISSION_ALREADY_EXISTS)`.

### A — Adversarial
Inputs that should be **rejected** with structured errors. The point is to verify the rejection path, not to break things.

For permissions: `read_ciphertext on SM item (matrix violation)`, `[mount_env, mount_env] (in-input duplicate)`, `[] (empty array)`.

### P — Pentests
Security boundary tests. Always cover at minimum:

- **Auth**: bogus token → `UNAUTHORIZED`, no token → `UNAUTHORIZED`
- **Cross-tenant**: cross-org agent ID → `AGENT_NOT_FOUND`, cross-org item ID → `ITEM_NOT_FOUND`, cross-profile within-org if the feature has profile scope
- **Tampering**: alter token mid-string, DB-write attacker tampers a column the encryption depends on
- **Enumeration**: list endpoints exclude things the caller shouldn't see
- **Audit completeness**: every denied access has a corresponding audit row (the AGENTS.md invariant)

For permissions on PR #119 we ran 10 pentests including AAD-tampering — see `references/test-categories.md` for the full list.

## The workflow

### 1. Capture the feature under test

Ask the user (or extract from conversation):

- What's the feature? (e.g., "multi-capability permission grants")
- What surfaces are involved? (API / CLI / MCP / Web)
- What's the security boundary? (org / profile / agent / item)
- Are there existing integration tests to draw scenarios from?

Read the feature's primary code (e.g., `packages/trpc/src/server/routers/<feature>.ts`) and the relevant `AGENTS.md` invariants. Any "Non-negotiable invariants" line that touches this feature is a hint about pentests to run.

### 2. Generate the test matrix

Draft `TESTING.md` from `assets/TESTING.md.template`. Number tests as `<category>.<scenario>.<variation>`:

- `H.1.1` `H.1.2` `H.1.3` — happy scenario 1, three variations
- `A.2.1` — adversarial scenario 2, variation 1
- `P.4.1` — pentest 4, variation 1

Each row: 1-sentence description, expected outcome (success or specific error code), pass criterion (DB row count, error code shape, audit entry).

### 3. Bring up the live stack

```bash
doppler run -- turbo dev --filter='!@abadge/docs' &
```

Mintlify needs `mint` which most devs don't have — **always exclude `@abadge/docs`**. Wait until both `:8787` (API) and `:3000` (Web) are listening.

See `references/dev-stack.md` for env vars, ports, and common errors.

If you can use `scripts/start-stack.sh`, do — it handles the Doppler invocation and waits for `:8787/health` to return ok.

### 4. Bootstrap a real test session

Better Auth requires a verified email. The fast path:

1. Sign up via `/api/auth/sign-up/email`
2. Direct DB update: `UPDATE "user" SET email_verified=true WHERE email=...`
3. Sign in via `/api/auth/sign-in/email` and capture the `set-auth-token` header (this IS the Bearer token)

`scripts/bootstrap-test-user.sh` does this in one shot. See also `references/auth-bootstrap.md`.

### 5. Run the harness

Use `assets/harness.sh.template` as a starting point. It includes:

- `trpc()` and `trpc_q()` helpers for POST mutations and GET queries
- `err_code()` for parsing the `.error.data.code` envelope (NOT `.error.json.data.code` — see gotchas)
- `ok()` / `fail()` / `hdr()` output helpers and a PASS/FAIL tally at the bottom

For CLI tests, set:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_SESSION_TOKEN="$BEARER_FROM_BOOTSTRAP"
```

And **move `~/.abadge/config.json` aside** — its `apiUrl` field overrides `ABADGE_API_URL`, will silently send your localhost session token to production, and you will spend 20 minutes debugging "Unauthorized" before you find this. See `references/cli-conventions.md`.

For agent bearer tokens (testing agent-side paths like `access.reveal`, `access.mount`, `items.listForAgent`), create the agent with `authMethod: legacy_api_key` — the response includes a one-time `apiKey` field that IS the bearer token.

### 6. Verify and iterate

After the harness runs:

- Tally PASS/FAIL per category
- For any failure, dig in: was the test wrong, the assertion off, or a real bug?
- Check audit log via `psql` for invariants — every denied access must have a `result='denied'` row
- If the harness uncovered a real bug, fix it and re-run. The matrix is fast to re-execute (~10s for 30 scenarios)

### 7. Save artifacts

- The harness script goes to `scripts/<feature>-pentest.sh` (executable, committed)
- `TESTING.md` stays in the repo root (committed). Append the run tally to a "Tally" section.
- If you discover a non-obvious pattern (a gotcha, an invariant assertion, a security property), add it to the relevant `references/*.md`. The skill compounds over time.

### 8. Tear down

- Kill background processes: `pkill -f "turbo dev" 2>&1; pkill -f "wrangler dev" 2>&1; pkill -f "next dev" 2>&1`
- Restore moved configs: `mv ~/.abadge/config.json.bak.pentest ~/.abadge/config.json`
- Optionally `TRUNCATE` the test data via psql (the test-user emails are sentinel-prefixed for easy cleanup)

`scripts/teardown.sh` handles all of this.

## Common gotchas (learned the hard way)

These have all cost real time in real runs. Read `references/api-conventions.md` and `references/cli-conventions.md` for the full list.

- **CLI config priority**: `~/.abadge/config.json.apiUrl` overrides `ABADGE_API_URL`. Move config aside before running CLI tests.
- **Multi-org user**: `X-Abadge-Org-Id` header is required for `sessionProcedure` / `scopedSessionProcedure` once the user has 2+ orgs.
- **Items.create input shape**: `{storageMode, payload}` only — no `profileId`. SM items get `profile_id=NULL`. Bind via DB UPDATE only if you know the AAD implications (see next bullet).
- **AAD binding (SM items)**: `(orgId, profileId, itemId, keyVersion)` is bound into the AES-GCM AAD at encrypt. Tampering with `profile_id` after the fact breaks decrypt with `INTERNAL_SERVER_ERROR/500`. This is **defence-in-depth**, not a bug — and worth turning into a pentest.
- **Item kinds**: enum is fixed (`login`, `api_key`, `token`, `json`, `certificate`, `ssh_key`, `opaque`). See `STANDARD_FIELDS_BY_KIND` in `packages/core/src/constants.ts`. Use `token` + `value` field for the simplest test items.
- **Rate limit**: 100 req/min/org. A full matrix run sits near the edge — insert waits between phases or split harnesses.
- **Error envelope**: `.error.data.code` (not `.error.json.data.code` — that's a different tRPC variant). Domain `cause` may live at `.error.data.cause.code`.
- **Greptile re-trigger phrase**: literal `@greptileai review` (no extra words). It will `+1` react to acknowledge.

## Templates and references

| File | What it is |
|---|---|
| `assets/TESTING.md.template` | Running-log template with H/E/A/P sections and a tally block |
| `assets/harness.sh.template` | Bash harness skeleton with helpers, auth bootstrap, and a few example assertions |
| `references/auth-bootstrap.md` | 4-line recipe for getting a Better Auth bearer token |
| `references/dev-stack.md` | Bring up the stack, expected ports, common errors |
| `references/api-conventions.md` | tRPC body shape, headers, error paths, response shapes |
| `references/cli-conventions.md` | CLI binary, env vars, config file priority gotcha |
| `references/test-categories.md` | Definitions and concrete examples of each category from real runs |
| `scripts/bootstrap-test-user.sh` | Turnkey: signup → verify → sign-in → echo bearer to stdout |
| `scripts/start-stack.sh` | Start dev stack via Doppler, wait until `:8787/health` is ok |
| `scripts/teardown.sh` | Kill processes, restore configs, truncate test data |

## Output

When you finish a run, the user has:

1. `TESTING.md` committed to repo root with H/E/A/P matrix and tally
2. `scripts/<feature>-pentest.sh` committed and executable
3. A run tally (PASS/FAIL per category) in chat with discovered bugs reported
4. The dev stack stopped, configs restored, no orphaned background processes

The harness is **idempotent** — anyone can re-run it after the change lands to verify nothing regressed.

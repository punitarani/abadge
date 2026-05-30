# DX Fix Campaign — implementation tracker

Drives the fixes for every finding in `2026-05-30-dx-usability-review.md`. Grouped into focused PRs
(branched off `main`; stacked only where a real dependency exists). Each PR: implement → test end-to-end
(live harness + e2e where it applies) → lint/typecheck/test green → push → open PR.

Status: `todo` · `wip` · `done` (committed) · `pr` (PR opened) · `merged`

## PRs

### PR-A · REST `/v1` facade (P0, S1) — `pr` (#229)
- [ ] `v1.ts:205` guard accepts function-typed caller nodes (the 500-on-every-call bug)
- [ ] `readQueryParams` coerces numeric/boolean query params (audit `?limit=N` → 400)
- [ ] New `/v1` e2e suite (apps/e2e): GET list/single, POST create, pagination, auth-required → 401 not 500
- [ ] Pre-resolution unauth path returns 401 + `WWW-Authenticate`, not 500 (stretch)
- Branch: `fix/rest-v1-facade`

### PR-B · CLI `item add` stdin (P0, S1) — `pr` (#230)
- [ ] `prompt.ts`: read piped (non-TTY) stdin to EOF as the value; resolve without requiring a newline
- [ ] prompt chrome → stderr (so `--json` stdout is clean)
- [ ] e2e/unit: `printf '%s' secret | abadge item add --json | jq .id` works (no newline)
- Branch: `fix/cli-item-add-stdin`

### PR-C · Capability vocabulary (P1, S2) — `pr` (#231)
- [ ] CLI `permission create` accepts canonical `read`/`use` on item grants (auto-map to legacy) AND/OR `--profile-id`
- [ ] SDK accepts canonical on item grants consistently; fix `--help` + `docs/CLI.md`
- [ ] e2e: `permission create --capability read --item-id` succeeds
- Branch: `fix/capability-vocab` (may touch core/cli/sdk/trpc)

### PR-D · CLI scripting & affordances — `pr` (#234 D1, #237 D2 profile-bootstrap)
- [ ] `org add --json`
- [ ] `agent mcp-config <id>` resolves by id from API (not just config.json)
- [ ] no-org error hint → surface-aware (`abadge org add`), not "complete onboarding"
- [ ] `profile bootstrap`/`init` command (unblock ZK from CLI)
- [ ] `profile list --json` → clean DTO (drop raw `wrappedRootKey`/`kdfSalt` columns)
- [ ] `run --expand-env`/`--all` reject silently-ignored `--field`/`--env-var`
- [ ] stale `profile create` hint → `profile add`
- Branch: `fix/cli-affordances`

### PR-E · SDK footguns (P1, S2/S3) — `pr` (#235)
- [ ] Remove/neuter `permissions.update()` (=revoke) and `profiles.update()` (=changePassword) aliases
- [ ] `AbadgeApiError.requestId` from `X-Request-Id`
- [ ] Discriminate `access.use` union return; fix JSDoc example
- [ ] `SecretValue` either used or removed; session-token acquisition documented
- [ ] mount/use runnable example
- Branch: `fix/sdk-ergonomics`

### PR-F · Errors, observability & SEC messaging — `pr` (#236 daemon+unlock; #238 denied-hint/audit-filters/mcp-config; #240 RED1-hint/web-audit)
- [ ] daemon error-masking: branch on `VAULT_LOCKED`/`ECONNREFUSED`/field (run.ts, resolve-secret.ts)
- [ ] web audit shows denial reason/field/mode/purpose
- [ ] MCP denied hint names actor + `abadge permission create …` command
- [ ] CLI `audit` filters (result/agent/item/event)
- [ ] SEC reframes: auto-lock window in unlock msg; MCP hint retarget; RED1 failure hint
- Branch: `fix/errors-observability`

### PR-G · Web DX (P2/P3) — `pr` (#233)
- [ ] create-item: default to an existing profile / profile picker (zk-default-empty-org trap)
- [ ] terminology: one name for the ZK secret (profile/master password); vault vs profile
- [ ] overview "last 24h" card honors window or relabel
- [ ] dead vault-security stubs; onboarding personal/org overlap; raw enum badges
- Branch: `fix/web-dx`

### PR-H · Docs accuracy + MCP docs (P3) — `pr` (#232)
- [ ] dim-docs sweep: canonical caps, mcp-config, audit flags, --json scope, multifield, api-key mint
- [ ] MCP README `kind` claim; AGENTS.md stale `run_with_secret` → `use_secret`
- [ ] mirror to apps/docs (Mintlify)
- Branch: `fix/docs-accuracy`

### SA-1 · Security-adjacent — `pr` (#239 docs reconciliation; gating routed to abadge-security-audit)
- [ ] `ownerReveal`/`abu_` reveal of server_managed plaintext: reconcile AGENTS.md wording + decide team-org gating. **Propose conservative fix + flag for `abadge-security-audit`; do not silently change auth semantics.**

## Log
- 2026-05-30: tracker created; starting PR-A.

- 2026-05-30: PR-A (#229) + PR-B (#230) opened, both TDD+live-verified green. Starting PR-C.
- 2026-05-30: PR-C (#231) opened. Dispatching subagents for PR-G (web) + PR-H (docs); driving PR-D/E/F directly.
- 2026-05-30: PR-G (#233) + PR-H (#232) opened via subagents (reviewed diffs). Dispatching PR-D1 (CLI wins) + PR-E (SDK) subagents.
- 2026-05-30: PR-D1 (#234) + PR-E (#235) opened via subagents (e2e+unit verified). Driving PR-F (errors/observability) + PR-D2 (profile bootstrap).
- 2026-05-30: PR-F (#236) opened (daemon error classification + unlock window, 279 tests green). Investigating PR-D2 (ZK profile bootstrap from CLI).
- 2026-05-30: PR-D2 (#237) profile bootstrap opened (crypto round-trip + live e2e). Dispatching polish subagent (MCP denied-hint, CLI audit filters, agent mcp-config); doing SA-1 docs reconciliation.

## Campaign complete — 12 PRs (#229–#240). See summary below.

## Final status — 2026-05-30

All 12 PRs **CI-green** (lint, typecheck, unit, integration, web, e2e, builds, changeset, audit; deploy jobs skip on PRs):

| PR | Title | Findings |
|----|-------|----------|
| #229 | fix(api): repair REST /v1 facade | DX-S1-A |
| #230 | fix(cli): item add piped-stdin | DX-S1-B |
| #231 | feat(cli): permission --profile-id | DX-001 |
| #232 | docs: reconcile MCP/CLI docs | dim-docs cluster |
| #233 | fix(web): dashboard papercuts | zk-default trap, terminology, 24h card, raw enum, one-time recovery |
| #234 | fix(cli): org/run/profile/error papercuts | DX-S2-A/C, run-flags, profile-list DTO, stale hint |
| #235 | fix(sdk): footguns + requestId | DX-S2-D, sdk-error-no-request-id, union JSDoc |
| #236 | fix(cli,mcp): daemon-failure messages | DX-S2-H, daemon/MCP SEC reframes, unlock window |
| #237 | feat(cli): profile bootstrap | DX-S2-G (ZK from CLI) |
| #238 | feat(cli,trpc): denial hints, audit filters, mcp-config | mcp-denied-hint, cli-audit-no-filters, agent-mcp-config dead-end |
| #239 | docs: reconcile abu_ owner-reveal invariant | SA-1 (gating routed to abadge-security-audit) |
| #240 | fix: MCP failure hint, audit detail, SDK docs | RED1 reframe, web-audit-denial, SecretValue/session-token docs |

Verification: every functional fix has unit and/or live e2e coverage against the real wrangler-dev + Postgres
stack (REST 200s proven; item-add round-trip; capability targets; profile-bootstrap crypto round-trip + live;
daemon error classification; MCP denial pipeline 32 integration tests; SDK footguns). The verify-stage caught
2 false premises and 1 harness artifact along the way.

Routed to follow-up (NOT a DX change): SA-1 ownerReveal/abu_ team-org gating → `abadge-security-audit`.

# Abadge Surface Map

Complete inventory of testable surfaces. The seed for `state/plan.yaml`. Every cell here is a "test bundle" — focused enough that a single subagent can exhaust it in one iteration.

Source-of-truth: `AGENTS.md` (codebase contract) + `docs/{API,CLI,MCP,SECURITY,FIELDS,ERRORS}.md` (consumer contracts).

## Conventions

- Each surface has its own subagent template at `subagents/<surface>-prompt.md`.
- Each cell is identified by `<surface>.<cell-id>` (e.g. `api.access.reveal-opaque`).
- Cells declare four facets: `happy`, `adversarial`, `edge`, `regression`. The plan matrix expands `(cell × facet)` so a single endpoint produces 4 distinct test bundles.
- Cells with `requires:` constraints (e.g. `dev_db`, `multi_org_user`, `playwright`) are gated by the controller's environment check.

---

## API surface (Hono + tRPC on Cloudflare Workers, port 8787)

### Auth & session
- `api.health` — `/health` GET
- `api.cors-preflight` — OPTIONS from allowed + denied origins
- `api.security-headers` — HSTS / COOP / CORP / Permissions-Policy presence
- `api.rate-limit-trpc` — 100/min boundary on `/trpc/*`
- `api.rate-limit-auth` — 60/min on `/api/auth/*`
- `api.404-default-body` — unknown route shape
- `api.body-size-limit` — payloads at 256 KB / 512 KB / 1 MB

### Better Auth (`/api/auth/*`)
- `api.auth.signup` — happy / dup-email / weak-pw / no-email-verify
- `api.auth.signin` — happy / wrong-pw / unknown-email enumeration
- `api.auth.signout` — session invalidation in DB
- `api.auth.forget-password` — endpoint absence (§AU1 regression)
- `api.auth.oauth-google` — preflight (full flow if creds available)
- `api.auth.oauth-github` — same
- `api.auth.device-code` — request → approve → exchange

### tRPC: `auth` router
- `api.auth.enroll` — bootstrap-token consume; single-use
- `api.auth.createChallenge` — agentId enumeration (§AUTH4)
- `api.auth.exchangeSession` — challenge replay; wrong signature; expired challenge

### tRPC: `organizations` router
- `api.organizations.create` — happy / multi-org user header (§O1)
- `api.organizations.list` — multi-org catch-22 (§O2)
- `api.organizations.update` / `delete` — owner-only; cascade audit
- `api.organizations.members.list`
- `api.organizations.members.updateRole` — owner self-demote (§OWN1)
- `api.organizations.members.remove` — sole-owner self-remove (§OWN2)
- `api.organizations.invitations.create` — captures email? (§I3)
- `api.organizations.invitations.list`
- `api.organizations.invitations.revoke`
- `api.organizations.getInviteInfo` — first-time invitee (§I4)
- `api.organizations.acceptInvite` — same; ALREADY_MEMBER 409 (§W22)

### tRPC: `profiles` router
- `api.profiles.create` — ZK + SM modes; auto-seed collision (§ON5)
- `api.profiles.list`
- `api.profiles.bootstrap` — Argon2id param weakness (§SEC11)
- `api.profiles.changePassword` — KEK rederive
- `api.profiles.rotateKey` — keyNonce serialization (§I5)
- `api.profiles.delete` — PROFILE_NOT_EMPTY guard

### tRPC: `items` router
- `api.items.create-zk`
- `api.items.create-sm` — profileId nullability (§I1, §I10)
- `api.items.list` — pagination absence (§L1)
- `api.items.get` — IDOR cross-org / null-byte (§I11)
- `api.items.update` — cross-mode no-op (§I8)
- `api.items.update-cv` — optimistic concurrency (STALE_VERSION)
- `api.items.delete` — soft-delete + cascade
- `api.items.ownerReveal` — operator-side reveal; §I2 corruption

### tRPC: `agents` router
- `api.agents.create` — duplicate name (§AG2), whitespace (§AG3)
- `api.agents.create-publickey-dup` — §AG4
- `api.agents.list` — no enabled filter (§AG1)
- `api.agents.rotate`
- `api.agents.revoke` — cascade session invalidation; audit rows

### tRPC: `permissions` router
- `api.permissions.create` — capability matrix gate
- `api.permissions.create-cross-org` — §P1 Effect.tryPromise swallow
- `api.permissions.create-past-expiry` — §P2
- `api.permissions.list`
- `api.permissions.revoke`

### tRPC: `access` router
- `api.access.ciphertext` — local-only, ZK-only gate
- `api.access.reveal-opaque` — happy
- `api.access.reveal-non-opaque` — §I2 envelope corruption
- `api.access.reveal-multifield-no-field` — §FLD2 whole-payload leak
- `api.access.reveal-zk-denied` — BAD_REQUEST + audit
- `api.access.mount-env` — secret delivery
- `api.access.mount-file` — secret delivery
- `api.access.expired-permission`
- `api.access.revoked-agent`

### tRPC: `audit` router
- `api.audit.list` — cursor pagination
- `api.audit.listForAgent` — cross-agent leak (§A1)
- `api.audit.cascade-tagging` — §I9 uniformity

### Cross-cutting
- `api.error-envelope` — `{code, message, hint, meta}` on every domain error (§E1)
- `api.stack-trace-leak` — §S1 prod-build verification
- `api.idor` — guess UUID from another org on every entity
- `api.input-fuzz` — null bytes / control chars / RTL / oversized strings on every text field

---

## CLI surface (`packages/cli`, compiled bun binary)

- `cli.help` / `cli.version`
- `cli.login` — device-code flow
- `cli.logout` — token cleanup
- `cli.daemon.start/stop/status` — socket 0600, PID file
- `cli.vault.unlock/lock/status` — single-org happy
- `cli.vault.unlock-multi-org` — §O3 daemon header
- `cli.vault.changePassword`
- `cli.item.list/create/update/delete`
- `cli.item.create-tty-value` — §CLI6 history leak
- `cli.agent.list/create/rotate/revoke`
- `cli.permission.create/list/revoke`
- `cli.run` — TTY guard; subprocess injection happy / absent secret
- `cli.mount` — file mode 0600
- `cli.release` — auto-cleanup
- `cli.audit.list`
- `cli.org.list/use` — multi-org catch-22
- `cli.profile.list/use/delete`
- `cli.import` / `cli.export` — round-trip fidelity (§IMP1, §EXP1, §EXP2)
- `cli.error-hint` — every error renders `hint`

---

## Web surface (Next.js, port 3000) — uses Playwright MCP or Chrome DevTools MCP

- `web.register` — happy / weak-pw / dup-email
- `web.login` — happy / wrong-pw / OAuth buttons render
- `web.onboarding.step1-org-create` — slug check, name validation
- `web.onboarding.step2-server-managed` — §ON5 silent fail
- `web.onboarding.step2-zk` — happy
- `web.onboarding.stale-localStorage` — §ON1
- `web.consent-links` — /terms /privacy 404 (§W17/§W18)
- `web.dashboard.overview`
- `web.items.list`
- `web.items.create-zk` — multiple kinds
- `web.items.create-sm` — multiple kinds
- `web.items.detail`
- `web.profiles.detail-buttons` — §W2 dead onClick
- `web.agents.create` — §AG4 dup publicKey via UI
- `web.agents.modal-mutation` — §W19 silent 400
- `web.permissions.modal` — §W19
- `web.invite.accept` — §I4 + §W22
- `web.audit.page` — filter + pagination
- `web.settings.vault-security` — blocked by §W2
- `web.support` / `web.feedback` — §W1 404
- `web.zustand-cross-user` — §W4 bleed
- `web.xss.org-name`
- `web.headers.csp` — when configured

---

## MCP surface (`packages/mcp`, stdio JSON-RPC)

- `mcp.boot.no-env` — fast-fail message
- `mcp.boot.keypair` — auth via `ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH`
- `mcp.boot.legacy-key` — `ABADGE_AUTH_TOKEN`
- `mcp.tool.list_items` — pagination; field filter
- `mcp.tool.run_with_secret.happy`
- `mcp.tool.run_with_secret.redaction` — §RED1 base64/hex/rot13/reverse bypasses
- `mcp.tool.run_with_secret.output-cap` — 4 KB
- `mcp.tool.mount_secret` — opaque mountId; never returns path
- `mcp.tool.mount_secret.persists-after-death` — §M2
- `mcp.tool.release_mount`
- `mcp.tool.get_audit.cross-agent-leak` — §A1
- `mcp.cleanup-orphans-on-startup`

---

## Daemon surface (`packages/daemon`, Unix socket JSON-RPC)

- `daemon.socket-perms` — 0600
- `daemon.pidfile`
- `daemon.mount-perms` — 0600 in 0700 dir
- `daemon.json-rpc.error-codes` — -32600/-32601/-32602/-32004 conformance
- `daemon.json-rpc.required-param` — error UX
- `daemon.json-rpc.locked-state` — error UX
- `daemon.vault.unlock/lock/status/changePassword`
- `daemon.item.encrypt/decrypt/rekey` — rekey primitive existence (§I5 amendment)
- `daemon.exec.env/mount/cleanup`
- `daemon.auto-lock` — 15-min inactivity boundary
- `daemon.stress` — 20 concurrent reqs
- `daemon.toctou.mount-write` — race between write and subprocess read
- `daemon.socket-impersonation` — non-owner connect attempt

---

## Crypto surface (`packages/crypto`)

- `crypto.kdf.argon2id` — params validation, timing
- `crypto.zk.xchacha20poly1305` — round-trip; tampering
- `crypto.sm.aes256gcm` — round-trip; nonce-reuse hazards
- `crypto.ed25519.keypair-sign-verify`
- `crypto.api-key.gen-hash-compare` — constant-time
- `crypto.token-prefixes` — `abe_` `abc_` `abs_` `abi_` entropy
- `crypto.encoding.base64url-base32`
- `crypto.salt-gen`
- `crypto.root-key.recovery-rewrap`
- `crypto.rekey.partial-failure` — abort mid-rewrap; verify no split state

---

## DB surface (`packages/db`, Drizzle + PlanetScale Postgres)

- `db.schema.{audit_logs, items, agents, profiles, permissions, agent_*, member, invitation, user, session, account, verification, deviceCode}` — column types, defaults, FK absence on audit_log
- `db.indexes` — coverage for known query patterns
- `db.connection-wrapper`
- `db.stale-tables` — §DB1 singular `audit_log` legacy
- `db.cascade-soft-delete-correctness`

---

## SDK surface (`packages/sdk`)

- `sdk.user.org-and-profile-methods`
- `sdk.user.member-mutate-payload-keys` — §SDK4 userId vs memberId
- `sdk.agent.connect-disconnect`
- `sdk.agent.session-refresh-T-2min`
- `sdk.agent.field-param-on-reveal-mount`
- `sdk.error.AbadgeApiError-shape`
- `sdk.naming-consistency` — §SDK7 ownerReveal vs ownerRevealItem

---

## Docs surface

- `docs.AGENTS.md` — drift vs code (§DOC*)
- `docs.API.md` — endpoint coverage / schema match
- `docs.ARCHITECTURE.md`
- `docs.CLI.md`
- `docs.MCP.md`
- `docs.SECURITY.md` — §TM1 plaintext-label claim
- `docs.FIELDS.md`
- `docs.ERRORS.md`
- `docs.ENVELOPE_SPEC.md` — §ENV1 7-kinds vs 1-decoded
- `docs.DEVELOPMENT.md`
- `docs.CI.md`

---

## Static surface

- `static.typecheck` — `bun run typecheck` 13 packages
- `static.lint` — `bun run lint` warning count + zero errors
- `static.format` — `bun run format`
- `static.test-suite` — `bun test` per package
- `static.build-prod` — `bun run build` + grep dist for stack traces (§S1)
- `static.changeset-coverage` — every PR has a changeset for affected packages

---

## Plan-cell expansion rule

For each cell above, the plan generator emits:

```yaml
- id: <cell>.<facet>
  surface: <surface>
  cell: <cell>
  facet: happy | adversarial | edge | regression
  status: pending
  parallelizable: true | false   # default true
  requires: [dev_db, multi_org_user, playwright, ...]
```

Cells flagged `requires: playwright` are deferred until the controller verifies the Playwright MCP is connected. Cells flagged `requires: multi_org_user` need a fixture user belonging to ≥2 orgs (controller can build via API on first reference).

## Maintenance

When abadge ships a new endpoint / CLI command / MCP tool / web page / DB table, append it here BEFORE it ships. Then:
- Existing sweep runs adopt the new cell on next iter (their `plan.yaml` is regenerated by `sweep-init.sh --add-missing` if needed, preserving prior `tested_at`).
- New runs include it from the start.

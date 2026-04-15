---
"@abadge/cli": patch
---

PR #89 review — P1 quality, UX, and defense-in-depth fixes (Phase B, stacked on Phase A blockers). Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the SDK/core/trpc/web changes below are internal but noted here for release-notes coherence.

**Consumer-visible SDK / API changes:**
- `AbadgeAgentClient`: session refresh timer now `.unref()`'d (CLI processes exit cleanly after agent ops); new optional `onSessionError(err, attempt)` callback; new optional `schedulerFn` (test-seam); bounded exponential-backoff retry (30s → 60s → 120s → 240s → 300s); client flips to `sessionExpired` state after exhaustion and outgoing calls reject fast with `SESSION_REFRESH_FAILED` / 401
- `organizations.members.list`: `email` is now `string | null` — populated only when caller is `owner` or `admin`; plain `member` callers receive `null` for every row
- `organizations.members.getInviteInfo`: rate-limited to 10 lookups/min per (user, IP); response narrowed to `{ organizationName, organizationSlug, role, expiresAt }` — `invitationId` and `inviterUserId` removed
- `organizations.create`: slug-race unique-violation now translated to `ConflictError` with code `SLUG_TAKEN`; org + member + default profile inserted atomically in a single transaction
- `organizations.list`: now ordered by `member.createdAt ASC` with a hard cap of 100 per response
- CLI `import --overwrite`: actually updates existing items now (previously silently hit `ITEM_ALREADY_EXISTS`); refuses overwrite for `zero_knowledge` items with a clear error directing the user to `abadge item delete` + re-import or `abadge item update`
- CLI `agent register --kind remote`: no longer writes to `~/.abadge/config.json` `localAgents.cli` (remote agents aren't local)
- New error codes: `SESSION_REFRESH_FAILED` (401), `SLUG_TAKEN` (409), `RATE_LIMITED` (429) — all in `@abadge/core`'s `ErrorCodeSchema`

**Internal reliability / security:**
- Web VaultProvider zeroes per-profile root keys on unmount AND on org switch
- Onboarding: auth guard; step-2 bootstrap failure rolls back the unbootstrapped profile; resumable if tab was closed mid-flow
- Web dashboard hint propagation: server-side `{code, message, hint, meta}` envelope now reaches every `toast.error` (was dropping `hint`)
- CLI/MCP catch-alls no longer collapse `AbadgeApiError` — hints + codes propagate to the user
- MCP `run_with_secret`: 8 KB pre-redaction bound (OOM DoS guard); independent stdout/stderr budgets; docs document exact-substring redaction limitations
- MCP tool error envelope widened to emit `{error, code, hint?, meta?}` for `AbadgeApiError`
- Cascades `onAgentRevoked` + `onItemDeleted` now transactional with bulk UPDATE … RETURNING + bulk audit INSERT
- Invite-token URL scrubbing: `Referrer-Policy: no-referrer` on /invite/accept, /login, /register; `router.replace` strips `?token=...` from URL after read
- `OneTimeSecretDisplay`: handles `navigator.clipboard.writeText` rejection with an error toast (stopped silently lying about copy success)
- Onboarding vault password inputs: `autoComplete="new-password"` + non-login `name` + unmount-clear
- Settings member-remove: confirmation dialog; delete-org dialog resets confirmText on close
- `ResultBadge` + `CapabilityBadge`: typed against `@abadge/core` unions; cascade result renders with a distinct variant instead of undifferentiated gray

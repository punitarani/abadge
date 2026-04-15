---
"@abadge/sdk": patch
"@abadge/core": patch
"@abadge/cli": patch
---

PR #89 review — P0 security and data-integrity fixes (Phase A).

**Security / authorization:**
- `items.listForAgent` now returns only items the calling agent has at least one permission on (was: every item in the agent's org, enabling metadata enumeration). See `@abadge/sdk` `AbadgeAgentClient.listItems` scoping.
- `exec.expandEnv` / `exec.env` daemon handlers now reject reserved loader env keys (`PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_*`, `*_PROXY`, `BASH_ENV`, `ENV`, `IFS`, `PYTHONPATH`, `PYTHONSTARTUP`, `BUN_INSTALL`, `BUN_CONFIG_REGISTRY`, `HOME`, `USER`, `SHELL`) and keys not matching `^[A-Z_][A-Z0-9_]*$`. Prevents subprocess hijack via agent-controlled item field names.
- `onMemberRemoved` cascade now revokes the removed member's agents, invalidates their live abs_ sessions, and deletes permissions they granted — all atomically in a single transaction. Previously only wrote an audit row.
- `verifyLegacyAgentIdentity` removed. Better Auth `apiKey()` plugin removed (migration 0006 dropped its table). Removed legacy API keys without a migrated `agents` row now return `UNAUTHORIZED` instead of an empty-org identity.
- `resolveUserOrgId` for session-auth now requires `X-Abadge-Org-Id` for users with >1 org membership (returns `ORG_HEADER_REQUIRED` 400 with `meta.availableOrgIds`); single-membership users get a deterministic `ORDER BY member.createdAt ASC` fallback; zero-membership users get `NO_ORG_MEMBERSHIP` 401.

**Error handling:**
- `access.reveal` / `access.mount` now propagate `FieldNotFoundError` and `MultiFieldItemError` intact (previously wrapped in `UnknownException` → 500 Unknown). Clients receive `{code: "FIELD_NOT_FOUND" | "MULTI_FIELD_ITEM", hint, meta.availableFields}`. Denied audit rows emitted on field-resolution failures.
- `profiles.rotateKey` input shape changed: `rekeyedItems: Array<{itemId, encryptedItemKey, keyNonce}>` (was `Record<string, string>` missing `keyNonce`, which caused silent decrypt failures post-rotate). Pre-flight rejects partial rekeys with `ROTATE_KEY_INCOMPLETE` listing missing itemIds.

**Data integrity:**
- `vault.rotateKey` (legacy) now includes `organizationId` in its WHERE clause — previously a user in multiple orgs could clobber cross-org items with wraps under a different root key.
- Migration 0006 is idempotent: every `ADD CONSTRAINT` now preceded by `DROP CONSTRAINT IF EXISTS`; `items.label SET NOT NULL` guarded by a DO-block that raises if backfill missed rows. Safe to re-run after partial failure.
- New migration 0007: `items.organization_id` is now `NOT NULL` with `ON DELETE CASCADE`. Org deletion now deletes items; previously orphaned them to NULL-org limbo that bypassed every isolation filter.
- Cascade events (`onAgentRevoked`, `onItemDeleted`, `onMemberRemoved`) now emit the declared `_cascade` event-type variants (`agent.revoke_cascade`, `permission.revoke_cascade`, `item.delete_cascade`) so audit queries can distinguish primary from cascaded side-effects.

**New error codes** (all in `@abadge/core` `ErrorCodeSchema`):
- `LEGACY_AGENT_UNMIGRATED` (401)
- `ORG_HEADER_REQUIRED` (400), `NO_ORG_MEMBERSHIP` (401), `ORG_MEMBERSHIP_REQUIRED` (401)
- `ROTATE_KEY_INCOMPLETE` (400)

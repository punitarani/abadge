---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Unified access pipeline + profile-level grants for the production
revamp:

- `access.read` / `access.use` / `access.useProfile` tRPC procedures
  built on `resolveAccess` and `resolveProfileAccess`; both handle ZK
  and SM items, both resolve item-level and profile-level grants
- Runtime constraint check (`access/constraints.ts`) replaces the
  compile-time `CAPABILITY_MATRIX` gating; remote+ZK and remote+use
  deny at access time with `INVALID_CAPABILITY`
- Audit-before-decrypt invariant preserved via in-memory staging +
  transaction-scoped flush for bulk operations (phantom-audit fix)
- `permissions.create` now accepts `{agentId, profileId, capabilities,
  expiresAt?}` for profile-wide grants
- Cascade audit on profile delete + agent revoke writes
  `permission.revoke_cascade` rows
- New `mount_reservations` table for short-lived `use`-action mount
  handles (TTL 5 min)
- `PermissionSchema` widened so `itemId` and `profileId` are both
  nullable (with exactly-one-target check at DB layer); CLI + web
  render profile-target rows correctly
- Legacy `access.ciphertext` / `access.reveal` / `access.mount` /
  `access.bulkMountEnv` procedures retained untouched; deletion in
  PR 4 once CLI / MCP / SDK migrate

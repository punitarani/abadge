---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Allow granting multiple capabilities per `(agent, item)` in one atomic call. `permissions.create`
now accepts `capabilities: Capability[]` (non-empty, deduplicated) and writes every row inside
a single Postgres transaction — partial grants are never observable. Matrix violations and
duplicates are pre-checked, and the error envelope's `meta.invalidCapabilities` /
`meta.duplicateCapabilities` lists every offender so the UI/CLI can recover precisely.

CLI: `abadge permission create --capability X --capability Y` and `--capability X,Y,Z`
both work — repeat the flag or comma-separate. Single-cap grants stay one short flag.

Breaking change to the public SDK shape: `CreatePermissionInput.capability` (singular)
becomes `capabilities: Capability[]`; `PermissionResult` is removed in favor of
`PermissionListResult`. The DB row layout is unchanged; the audit log invariant
(one `permission.create` row per granted capability) is preserved.

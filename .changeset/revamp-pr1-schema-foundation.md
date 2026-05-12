---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Schema foundation for the production revamp (additive, behaviorally
neutral for existing tRPC callers):

- `profiles.externalId` (nullable text) with per-org unique partial
  index for idempotent customer provisioning
- `items.user_id` → `items.created_by` (renamed, nullable, ON DELETE
  SET NULL) — audit metadata, not ownership
- `permissions.profile_id` (nullable) + `permissions_exactly_one_target`
  CHECK constraint + partial unique indexes for both target shapes
- `CAPABILITIES` extended with canonical `read`/`use`; legacy four
  retained with `LEGACY_TO_CANONICAL` map; `CAPABILITY_MATRIX` marked
  `@deprecated`
- New schemas: `ReadAccessSchema`, `UseAccessSchema`,
  `ProfileUseAccessSchema`, `ReadAccessResponseSchema`,
  `UseAccessResponseSchema`
- `CreatePermissionSchema` is a discriminated union of `{itemId,...}`
  and `{profileId,...}` (mutually exclusive)
- `permissions.create` rejects `profileId`-target inputs with
  `BadRequestError` until PR 2 enables them via the unified pipeline
- Fix: `scripts/init-test-db.sh` was missing `--dbname`, preventing
  Postgres from coming up locally

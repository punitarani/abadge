---
"@abadge/trpc": patch
"@abadge/db": patch
"@abadge/api": patch
---

Close security gap: profile existence oracle, AB-0003 migration guard, AB-0011 AC3 test, health-endpoint role assertion

- `profiles.ts`: use `scopedDb.findFirst` in `loadProfile`/`loadProfileForWrite` so a cross-org profileId returns "not found" rather than "forbidden", eliminating the cross-org existence oracle.
- `0022_backfill_guard.sql`: preflight migration that fails loudly if any server_managed items still have NULL profileId (run `scripts/backfill-server-item-profiles.ts` first, mirroring the 0007 pattern from AB-0001).
- `rls-backstop.test.ts`: adds AC3 test — a bare non-transactional SELECT outside any `.transaction()` call against the restricted role returns zero rows (SET LOCAL never applied, GUC is NULL, policy evaluates false → fail-closed).
- `/health` endpoint now returns `db.role` and `db.bypassRls` so deployment misconfiguration (connecting as owner instead of app_runtime) is immediately visible without needing a separate diagnostic tool.

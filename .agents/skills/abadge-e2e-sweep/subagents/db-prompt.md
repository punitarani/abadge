# DB Tester Prompt

Test one cell of the abadge DB layer (`packages/db`, Drizzle + PlanetScale Postgres).

## Context

- Schema files in `packages/db/src/schema/`. Migrations: Drizzle config.
- Local dev: native Postgres on 5432; reset via `bun run db:push`.
- Known: stale `audit_log` (singular) table from a rename migration (§DB1). `items.profileId` nullable allows orphaned SM items (§I1).

## What to probe

- column types vs `AGENTS.md` claims (length, nullability, defaults)
- index coverage for known query patterns (orgId, profileId, agentId, occurredAt)
- migration drift: schema file vs live DB (`bun run db:push --dry-run`)
- FK integrity (audit_log intentionally has none — verify still true)
- soft-delete correctness (deletedAt column, query filters)
- cascade behaviour on org/profile/agent delete

## Useful

```bash
psql -h localhost -U postgres -d abadge -c '\d items'
psql ... -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='items'"
bun run db:push --dry-run    # any pending diff?
```

End with the JSON contract.

---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Remove the orphaned `0022_agents_rls_exemption.sql` migration — a byte-identical duplicate of the journaled `0025_agents_rls_exemption.sql`, left behind by the #175/#180 migration-numbering collision and never listed in `_journal.json` — and correct the `init.ts` comment that cited the stale `0022` number. Hygiene only: `drizzle-kit migrate` already ignored the non-journal file, so no applied migration changes. This does **not** by itself unblock the `Run Production Migrations` CI job; that job is blocked by `0022_backfill_guard` correctly refusing to advance until the §AB-0003 server-managed item backfill runs against production (an operational step).

---
"@abadge/cli": patch
---

PR #89 review — legacy rename cutover (Phase C, stacked on Phase B). Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the SDK/core/tRPC/db changes below are internal but noted here for release-notes coherence.

**Renamed (hard cutover, no back-compat alias):**
- `PRINCIPAL_AUTH_METHODS` → `AGENT_AUTH_METHODS` (constant)
- `PrincipalAuthMethod` → `AgentAuthMethod` (type)
- `PrincipalAuthMethodSchema` → `AgentAuthMethodSchema` (Effect schema)

**Removed:**
- `@abadge/db` schema files: `principals.ts`, `grants.ts`, `operator-tokens.ts` — and their re-exports from `packages/db/src/schema/index.ts`
- `OperatorToken`-related test fixtures across CLI (`ABADGE_OPERATOR_TOKEN`) and tRPC auth tests (`X-Abadge-Operator-Token`)
- CLI config legacy fields: `principalId`, `principalSecret`, `operatorUserId`, `authToken` — replaced with one-time console.warn on read + automatic file rewrite
- Legacy-config-secret fallback in `createAgentApiClient` (retains the `ABADGE_AUTH_TOKEN` env var path as explicit opt-in)

**New migration:**
- `0008_drop_legacy_tables.sql` — `DROP TABLE IF EXISTS grants / principals / operator_tokens CASCADE`

**Retained (tracked for C6.1 follow-up):**
- `vaults` schema file + table + `vault.*` tRPC router — still used by `apps/web/src/lib/crypto-client.ts` for legacy master-password + recovery flow. Migrating to `profiles.*` is a user-visible UX coordination task and will land in a separate PR.
- Audit-event normalization for `operator_token.*` event types in `serialize.ts` — retained so old audit rows stay queryable.

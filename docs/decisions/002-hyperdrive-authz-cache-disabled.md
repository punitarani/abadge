# ADR-002: Disable Hyperdrive Query Caching for Authorization Freshness

**Status:** Accepted
**Date:** 2026-05-26

## Context

The API runs on Cloudflare Workers and reaches PlanetScale Postgres through a Hyperdrive connection-pooling proxy. Hyperdrive caches read-only query results for a default ~60s TTL and does **not** invalidate the cache on writes ([Cloudflare docs](https://developers.cloudflare.com/hyperdrive/configuration/query-caching/)).

abadge is a credential firewall: its authorization decisions are read-only `SELECT`s — permission lookups (`lookupPermission`), agent enabled/revoked state, agent-session validity, and item soft-delete checks. If those reads are cache-served, a just-revoked permission, a disabled agent, or an expired session could keep authorizing secret access for up to the cache TTL. For a kill-switch in a credential broker, a bounded-but-real stale-authz window is unacceptable.

## Decision

**Disable Hyperdrive query caching globally** for the abadge Hyperdrive configuration.

Caching is a per-Hyperdrive-**resource** setting — it is *not* a `wrangler.jsonc` binding field (wrangler emits `Unexpected fields found in hyperdrive[0] field: "caching"` and ignores it). It is disabled via the Wrangler CLI against the resource id. Read the id from `hyperdrive[0].id` in `apps/api/wrangler.jsonc` (or `wrangler hyperdrive list`) rather than a literal copied here, which goes stale if the resource is recreated:

```bash
HYPERDRIVE_ID=<hyperdrive[0].id from apps/api/wrangler.jsonc>

wrangler hyperdrive update "$HYPERDRIVE_ID" \
  --origin-password "$DB_PASSWORD" --caching-disabled true

# verify (expect caching.disabled = true):
wrangler hyperdrive get "$HYPERDRIVE_ID"
```

This is an operational action on the Cloudflare resource: it persists across deploys but lives outside version control. Re-assert `--caching-disabled true` and re-verify with `wrangler hyperdrive get` after **any** `wrangler hyperdrive update` to this resource (e.g. rotating `--origin-password`), not only when the config is recreated — an `update` that omits the flag can revert to the cached default and silently reopen the stale-authz window. The `wrangler.jsonc` binding carries a comment pointing here.

## Alternatives

- **Per-query uncacheable marking** — rejected: Hyperdrive cacheability is not controllable per-query through `postgres-js`; there is no reliable hook to mark individual authz `SELECT`s uncacheable, and a single missed query fails *open* (stale authz). Global disable is the only reliable control.
- **Two Hyperdrive bindings (cached + uncached)** — rejected for beta: nearly every abadge query is authz-sensitive, so a cached binding would have almost no safe use; the complexity is not justified by the small latency win.
- **Keep default caching** — rejected: the stale-authz window after revocation is unacceptable for a credential firewall.

## Consequences

- Authorization reads always reflect current DB state; revocations and expirations take effect immediately. App-level immediacy is covered by the grant→revoke→deny integration tests (`permissions.test.ts`, `cascades.test.ts`) — the Hyperdrive cache was the only remaining stale layer between the Worker and Postgres.
- Slightly higher DB read load and latency (no cache). Acceptable for a security-critical API; revisit with targeted caching of immutable metadata (item labels, org names) if latency demands it.
- The disable lives on the Cloudflare resource, **not** in version control. It must be part of infra provisioning (documented here and in `docs/SECURITY.md` → API Hardening), not assumed from `wrangler.jsonc`.

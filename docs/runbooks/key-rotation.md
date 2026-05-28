# Runbook: server-managed key rotation (AB-0090)

Covers rotating the server-managed encryption keys: the master `ENCRYPTION_KEY` (KEK) and per-profile data-encryption keys (DEKs). Zero-knowledge profile keys are out of scope — those rotate client-side via `profiles.rotate` (see `docs/SECURITY.md`).

> **Rehearse on staging first.** Every procedure below MUST be run against staging with a sampled-decrypt validation (step "Validate") before production. Take a verified DB backup before any production run.

## Background: the envelope (AB-0030)

- `serverKeyVersion >= 3` content is encrypted under a **per-profile DEK**. The DEK is wrapped by the master `ENCRYPTION_KEY` (AAD-bound to `{ orgId, profileId }`) and stored in `profiles.server_wrapped_dek`. Content is never encrypted directly under the master key at v3+.
- `serverKeyVersion 1/2` (legacy, pre-AB-0030) content is encrypted **directly under the master key** (v1: no AAD; v2: profile-bound AAD). A master rotation breaks these rows unless they are first re-encrypted into the v3 envelope (see step A.4); the AB-0003 backfill only binds NULL-profile rows and leaves them at v2.
- Helpers: `wrapServerDek` / `unwrapServerDek` / `generateServerDek` in `@abadge/crypto/server`; `serverEncrypt` / `serverDecrypt` for content; `encryptServerEnvelope` / `decryptServerEnvelope` in `@abadge/trpc` for the full per-profile path.

---

## A. Master `ENCRYPTION_KEY` (KEK) rotation — the common case

Use on suspected `ENCRYPTION_KEY` disclosure, or scheduled KEK rotation. For v3 rows **no content is re-encrypted** — only the per-profile DEKs are re-wrapped, so this is cheap and fast.

1. **Provision** the new key as `ENCRYPTION_KEY_NEXT` (keep the old `ENCRYPTION_KEY` available for rollback). Both 32-byte base64.
2. **Make reads tolerate both wrappings before rewrapping.** The rewrap (step 3) commits per batch, so the moment a profile's DEK is wrapped under the new key, a Worker still holding only the old key can no longer `unwrapServerDek` it — every read for that profile fails with an AES-GCM auth error until cutover (step 5). Close this window with one of:
   - **Dual-key reader (zero downtime):** first deploy a Worker build whose unwrap path tries `ENCRYPTION_KEY`, then falls back to `ENCRYPTION_KEY_NEXT`, so both wrap formats decrypt for the whole rewrap.
   - **Maintenance window:** pause server-managed access during the rewrap. The rewrap touches only DEKs (never content), so the window is short.
3. **Rewrap** every profile DEK with the same `{ orgId, profileId }` AAD: for each `profiles` row with a non-null `server_wrapped_dek`:
   - `dek = unwrapServerDek(OLD_KEY, row.server_wrapped_dek, { orgId: row.orgId, profileId: row.id })`
   - `newWrapped = wrapServerDek(NEW_KEY, dek, { orgId: row.orgId, profileId: row.id })`
   - `UPDATE profiles SET server_wrapped_dek = newWrapped WHERE id = row.id` (batched, one transaction per batch).
   - Run via a one-shot script mirroring `scripts/backfill-server-item-profiles.ts` (dry-run first; idempotent; per-batch commit).
4. **Re-encrypt direct-key legacy content** if any remains (`SELECT count(*) FROM items WHERE storage_mode='server_managed' AND server_key_version < 3`): v1/v2 rows are encrypted directly under the master key, so they must move to the v3 envelope or the rotation strands them. Run the AB-0003 backfill (`scripts/backfill-server-item-profiles.ts`) first so every server-managed item is bound to a real profile (the v3 envelope is per-profile), then decrypt each remaining row under `OLD_KEY` and re-encrypt via `encryptServerEnvelope` (binds the profile DEK, lands as v3).
5. **Cut over**: set `ENCRYPTION_KEY = NEW_KEY` in the Worker secret (`wrangler secret put` / Doppler), then drop `ENCRYPTION_KEY_NEXT` and the dual-key fallback (or lift the maintenance window) and deploy.
6. **Validate** (below).
7. **Retire** the old key only after validation passes and a soak period.

**Rollback:** the rewrap is reversible — re-run step 3 with NEW↔OLD swapped (unwrap with NEW, rewrap with OLD), and restore `ENCRYPTION_KEY = OLD_KEY`. Because content was never re-encrypted for v3 rows, no data is at risk as long as the old key is retained.

---

## B. Per-profile DEK rotation

Use on suspected disclosure of a single profile's DEK, or to bound a profile's AES-GCM nonce budget (AB-0031, before 2²⁸ writes).

1. `oldDek = unwrapServerDek(ENCRYPTION_KEY, profile.server_wrapped_dek, { orgId, profileId })`; `newDek = generateServerDek()`.
2. In one transaction per batch, for each server-managed item in the profile: decrypt under `oldDek` (with its stored AAD), re-encrypt under `newDek` via `serverEncrypt` with a bumped `serverKeyVersion` and the new AAD (`keyVersion` is part of the AAD tuple), update `server_ciphertext`/`server_iv`/`server_key_version`.
3. `UPDATE profiles SET server_wrapped_dek = wrapServerDek(ENCRYPTION_KEY, newDek, { orgId, profileId })`.
4. **Validate**, then discard `oldDek`.

**Rollback:** keep `oldDek` (wrapped) until validation passes; re-run with old/new swapped to revert.

---

## Validate (after any rotation)

```sql
-- Every server-managed v3 profile must have a wrapped DEK.
SELECT count(*) FROM profiles WHERE server_wrapped_dek IS NULL
  AND id IN (SELECT DISTINCT profile_id FROM items
             WHERE storage_mode='server_managed' AND server_key_version >= 3);
-- expected: 0

-- No legacy rows left after a master rotation that included re-encryption.
SELECT count(*) FROM items WHERE storage_mode='server_managed' AND server_key_version < 3;
-- expected: 0 (after step A.4)
```

Then run a **sampled decrypt** across N random server-managed items per org (via `items.ownerReveal` or a script calling `decryptServerEnvelope`) and assert **zero failed decrypts**. This is the staging sign-off gate and the production post-cutover check.

## Notes

- Rotation does not touch RLS, audit, or auth. The DAL's `scopedDb` continues to set `app.current_org` per transaction (AB-0011).
- The migrator/owner role performs the rewrap; the runtime `app_runtime` role (AB-0012) needs only the DML it already has.

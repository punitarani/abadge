# ADR-004: Per-profile envelope encryption for server-managed items

**Status:** Accepted (design); implementation tracked as AB-0030
**Date:** 2026-05-26

## Context

Server-managed items are encrypted with AES-256-GCM directly under the single
master `ENCRYPTION_KEY` (`serverEncrypt(plaintext, ENCRYPTION_KEY, …)`), with
AAD binding the row to `(orgId, profileId, itemId, keyVersion)` as of v2
(§AB-0001). Two problems remain:

1. **Blast radius.** Every server-managed secret across every org and profile is
   encrypted under the *same* key. A disclosure of `ENCRYPTION_KEY` exposes all
   of them at once. ADR-001 already calls this mode "envelope encryption," but it
   is not yet an envelope — there is no intermediate key.
2. **Rotation cost.** Rotating `ENCRYPTION_KEY` today requires decrypting and
   re-encrypting **every** server-managed ciphertext, because content is bound
   directly to the master key. That is O(secrets) work and risk per rotation.

ZK items already solve this (root key → per-item DEK → ciphertext). Server-managed
items need an analogous intermediate key.

## Decision

Introduce a **per-profile Data Encryption Key (DEK)** for server-managed items —
the "wrapped DEK" envelope shape (cf. Infisical, Vault transit):

```
ENCRYPTION_KEY  --wraps-->  profile DEK (32 bytes, per server_managed profile)  --encrypts-->  item ciphertext
```

- Each `server_managed` profile stores `serverWrappedDek` = the profile's random
  32-byte DEK, AES-256-GCM-encrypted under `ENCRYPTION_KEY` with the wrap AAD-bound
  to `(orgId, profileId)` so a wrapped DEK cannot be transplanted between profiles.
- New server-managed item writes (`serverKeyVersion = 3`) encrypt the payload
  under the **profile DEK**, not the master key. AAD binding is unchanged
  `(orgId, profileId, itemId, keyVersion)`.
- Decryption branches on `serverKeyVersion` (see ENVELOPE_SPEC §"Server-managed
  per-profile envelope (v3)").

### Why per-profile (not per-org, per-item, or HKDF)

| Option | Verdict |
|---|---|
| **Per-profile stored DEK** (chosen) | Containment boundary = the profile (the product's encryption boundary). Master-key rotation rewraps DEKs only — zero content re-encryption. Matches Infisical/Vault. |
| HKDF per-org subkey | **Rejected.** A derived key gives no containment against master-key disclosure (the master derives every subkey) and no rotation benefit. (Prior research, §AB-0030 reframe.) |
| Per-item DEK | Overkill for server-managed: the server can read every item in a profile anyway (that is the mode's purpose), so per-item adds key-management cost without a new trust boundary. Per-profile is the smallest boundary that matters here. |

## Consequences

- **Blast radius** drops from "all server-managed secrets" to "one profile" for a
  leaked DEK; `ENCRYPTION_KEY` disclosure still requires unwrapping each profile
  DEK (and is mitigated further by KEK→KMS, ADR-003).
- **Rotation** of `ENCRYPTION_KEY` becomes O(profiles) rewraps with **zero**
  content re-encryption (AB-0030 acceptance #4; runbook AB-0090).
- **Backward compatible.** v1 (no AAD) and v2 (direct-key + AAD) rows decrypt
  unchanged via the version branch; only new writes are v3. A backfill of v1/v2 →
  v3 is a separate, optional migration (mirrors AB-0003).
- Enables AB-0032 (key commitment) and frames AB-0031 (per-key IV ceiling — a
  per-profile DEK shrinks the GCM-IV budget per key, see ENVELOPE_SPEC).

## Implementation plan (AB-0030 and follow-ups)

1. **Crypto + spec (this ADR).** Define wire format, version semantics, golden
   vectors in `docs/ENVELOPE_SPEC.md`.
2. **Schema.** Add `profiles.server_wrapped_dek` (nullable; populated for
   `server_managed` profiles on create/bootstrap and lazily on first v3 write —
   the lazy path is a transactional compare-and-set, see ENVELOPE_SPEC).
3. **Crypto primitive.** `wrapServerDek` / `unwrapServerDek` + an item
   encrypt/decrypt path that takes the unwrapped DEK, with golden-vector tests.
4. **Wire it.** `items.create` (server-managed) encrypts under the profile DEK at
   v3; the decrypt sites branch v1/v2/v3.
5. **Rotation.** `ENCRYPTION_KEY` rotation rewraps `server_wrapped_dek` per
   profile (AB-0090 runbook), content untouched.

Steps 2–5 are deliberately separate PRs from this design so the crypto code lands
with golden vectors under review, not rushed.

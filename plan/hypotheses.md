# Open hypotheses

| # | Question | Current best answer | Confidence | Evidence that would update |
|---|---|---|---|---|
| H1 | Can PlanetScale Postgres + Hyperdrive run RLS with per-tx `SET LOCAL app.current_org` safely under connection pooling? | Probably, IF every scoped query runs inside an explicit tx (SET LOCAL is tx-scoped). Risk: Drizzle non-tx queries on pooled conns. | low | Phase-1A research; PlanetScale role/RLS docs; Hyperdrive pooling semantics |
| H2 | Does PlanetScale Postgres allow a custom app role with REVOKE UPDATE/DELETE + triggers (for audit append-only)? | Likely yes (it's Postgres-compatible) but role management may be constrained on managed service. | low | Phase-1A research |
| H3 | Is making server_managed items carry profileId purely additive (no decrypt break for existing rows)? | New rows: set profileId + AAD uses it. Existing rows have profileId NULL + AAD sentinel → must keep decrypting with sentinel. Needs version/branch on read. | medium | re-read items.ts update/decrypt; confirm AAD read branch keys off stored profileId only |
| H4 | Will fixing W1 by adding profileId to AAD strand existing server_managed ciphertext? | Yes if we change AAD for existing rows. Mitigation: only NEW rows bind real profileId; reads use stored value (already `profileIdForServerAad(item.profileId)`). | medium | trace items.ts:360,449 decrypt AAD |
| H5 | Per-org key derivation: HKDF(ENCRYPTION_KEY, salt=org_id) vs envelope/KMS — which for beta? | HKDF subkey: zero new infra, fixes blast radius. KMS = post-beta. | medium | Phase-1C + benchmark B |
| H6 | Is the daemon TOFU fingerprint pinning robust (MITM on unix socket)? | Not verified. Unix socket 0600 + TOFU likely adequate locally. | low | read daemon-client pinning + cli config |

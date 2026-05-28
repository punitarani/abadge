# ADR-003: Defer the Server-Managed Root KEK to an External KMS

**Status:** Accepted (deferred — implementation gated on a trigger)
**Date:** 2026-05-26
**Supersedes:** the draft plan's ADR-005 (per-item KMS DEK from day one)
**Builds on:** ADR-R3 / AB-0030 (per-profile wrapped-DEK envelope)

## Context

Server-managed items are encrypted with AES-256-GCM under a single `ENCRYPTION_KEY` held in the Cloudflare Worker environment (`packages/crypto/src/server`). The planned per-profile envelope (AB-0030) introduces a random per-profile DEK *wrapped* by that env KEK — which contains the AES-GCM nonce budget and enables cheap rotation, but **does not change the blast radius of a double compromise**: an attacker holding both the env secret *and* a database dump can unwrap every per-profile DEK and decrypt all server-managed secrets, because the KEK that unwraps them lives in the same trust domain as the application.

Containing that env+DB double-compromise requires the KEK to live in a **separate trust domain** — an external KMS (AWS/GCP) in a different cloud account — so that a DB disclosure plus a Worker compromise still hits an IAM wall.

## Decision

**Defer** moving the root KEK to an external KMS. For beta, the bar is the env KEK + per-profile wrapped DEKs (AB-0030). Record the trigger and the (rewrap-only) migration path here, and document the honest limitation in `docs/SECURITY.md`.

**Trigger to implement:** the first regulated/enterprise customer with a documented per-tenant key-isolation requirement, **or** when the env+DB double-compromise (threat-3) enters the active threat model.

## Alternatives

- **Per-item KMS DEK from day one** (draft ADR-005) — rejected for beta: cross-cloud IAM plus a KMS round-trip on every server-managed decrypt is operational cost beta does not need.
- **HKDF-derived per-org subkeys from the master** — rejected: deterministic derivation gives zero blast-radius containment against master disclosure (a master leak derives every subkey). This is also why AB-0030 chose stored wrapped DEKs over HKDF.
- **Status quo (single env key, no envelope)** — rejected by AB-0030: weaker than every peer; no per-tenant rotation.

## Consequences

- Because AB-0030 already stores **wrapped DEKs**, the future migration is **rewrap-only**: unwrap each profile DEK with the env KEK, rewrap via `KMS.Encrypt` with an `EncryptionContext` binding `(org, profile, item)`, and store — **no item content is re-encrypted**. This ADR is what makes that cheap later.
- When implemented, DEK unwrap requires a KMS call bound to the Worker's IAM identity (so a DB dump alone, or a Worker compromise alone, cannot decrypt); `Decrypt` calls are logged via CloudTrail for a cross-cloud audit trail.
- KMS availability/latency become a hard dependency for server-managed decrypt — mitigated by short-lived in-request DEK caching and KMS regional redundancy.
- **Until the trigger fires:** `ENCRYPTION_KEY` (env) plus a database dump decrypts all server-managed secrets. This is documented as an explicit limitation in `docs/SECURITY.md` (Server Breach Impact). Zero-knowledge items are unaffected — the server never holds their keys.

## Acceptance (AB-0033)

- ADR recorded with the trigger condition and trade-offs — **met (this document)**.
- DEK unwrap requires a bound KMS call (staging integration test) — **deferred** until the trigger fires (no code in this change).
- No server-managed content re-encrypted during migration (only DEKs rewrapped) — guaranteed by the rewrap-only design above; verified when implemented.

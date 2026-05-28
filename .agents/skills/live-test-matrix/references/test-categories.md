# Test categories — definitions and concrete examples

Each scenario class needs ≥3 variations. This file shows what good coverage looks like for each category, with examples drawn from PR #119 (multi-capability permission grants).

## H — Happy paths

The flows the feature is built for. Cover the dimensions of the input space — don't just run the "default" flow three times.

**Good coverage:**

- `H.1.1` — local CLI agent + ZK item + `read_ciphertext` (single-cap as 1-element array)
- `H.1.2` — local CLI agent + server-managed item + `mount_env`
- `H.1.3` — remote agent + server-managed item + `reveal_plaintext`
- `H.2.1` — local + SM + 3-cap batch `[reveal_plaintext, mount_env, mount_file]`
- `H.2.2` — local + ZK + 3-cap batch `[read_ciphertext, mount_env, mount_file]`
- `H.2.3` — 2-cap batch (variation on count)

The dimensions exercised here: agent locality, storage mode, capability count. Three rows per scenario class is the floor.

**Bad coverage** — three identical happy-path runs:
- `H.1.1` — grant a permission
- `H.1.2` — grant a permission again
- `H.1.3` — grant a permission yet again

That's not three variations; it's one test repeated.

## E — Edge cases

Boundary conditions, unusual but valid inputs, multi-X-within-Y combinations, list-filter compositions, expiry edges, idempotence after revoke.

**Good coverage:**

- `E.1.1` — 3-cap batch with shared `expiresAt` (all 3 rows carry same TTL)
- `E.1.2` — `permissions.list({agentId, itemId})` AND-combined (filter composition)
- `E.1.3` — re-grant the same cap after revoke (no `PERMISSION_ALREADY_EXISTS` because the row was deleted)
- `E.2.1` — multi-agent on same item, disjoint cap sets, independent revoke
- `E.2.2` — single agent across two profiles in same org
- `E.2.3` — two orgs (same user as member) — no cross-org grant leakage

These exercise composition: combining things that work fine individually but might break when nested.

## A — Adversarial

Inputs that should be **rejected** with structured errors. The point is to verify the rejection path returns the right code with the right `meta`, not to break things.

**Good coverage:**

- `A.1.1` — `read_ciphertext` on server-managed item → `INVALID_CAPABILITY_STORAGE` with `meta.invalidCapabilities=["read_ciphertext"]`
- `A.1.2` — `mount_env` on remote agent → `INVALID_CAPABILITY_LOCALITY`
- `A.1.3` — mixed valid + invalid in batch — entire batch rolled back, 0 rows written
- `A.2.1` — duplicate already-granted cap → `PERMISSION_ALREADY_EXISTS` with `meta.duplicateCapabilities`
- `A.2.2` — in-input duplicate `[mount_env, mount_env]` → `BAD_REQUEST` (rejected at schema, not router)
- `A.2.3` — empty array `[]` → `BAD_REQUEST` (`Schema.NonEmptyArray` filter)

Always probe the `meta` field on adversarial assertions — it's how you catch silent shape changes.

## P — Pentests

Security boundary tests. Always cover at minimum these axes:

### Auth axis
- `P.1.1` — bogus session token → `UNAUTHORIZED`
- `P.1.2` — no auth header at all → `UNAUTHORIZED`

### Cross-tenant axis
- `P.2.1` — cross-org agent ID injected into a same-user op → `AGENT_NOT_FOUND`
- `P.2.2` — cross-org item ID injected → `ITEM_NOT_FOUND`
- `P.2.3` — tampered `X-Abadge-Org-Id` header (org2's id while doing org1's op) → org isolation holds

### Cross-profile axis (only if feature has profile scope)
- `P.3.1` — agent with permission on item-in-profile-A is denied on item-in-profile-B
- `P.3.2` — `items.listForAgent` excludes profile-B items (enumeration leak blocked)
- `P.3.3` — revoking all profile-A permissions collapses agent's reach to zero

### Tampering axis
- `P.4.1` — bearer with valid prefix but bad body → `UNAUTHORIZED`
- `P.4.2` — DB-write attacker tampers a column the encryption depends on (e.g., `profile_id` for SM AAD) → ciphertext fails to decrypt, `INTERNAL_SERVER_ERROR/500`. This is defence-in-depth; the AAD prevents access redirection via column tampering.

### Audit axis
- `P.5.1` — every denied access from above produces a `result='denied'` row in `audit_logs`. Final assertion: `SELECT count(*) FROM audit_logs WHERE result='denied' AND organization_id=...` ≥ count of failed pentests.

### Schema-injection axis
- `P.6.1` — fuzz input with SQL-injection-shaped values. The Effect Schema's enum filter rejects pre-router. After the attack, verify the table is still queryable: `SELECT count(*) FROM <target_table>`.

## Why ≥3 per category

Three is the floor because:

1. **Two assertions can both be wrong in the same direction.** A third independent variation catches that.
2. **Real bugs hide in the corners.** The cross-profile AAD-tampering finding from PR #119 was only discovered because the matrix forced a sanity-decrypt that tripped over the `profile_id` rebinding — a single-shot pentest never would have noticed.
3. **The matrix structure forces the writer to think across dimensions** (locality × storage × count, etc.). One assertion per category collapses the matrix into a checklist.

If you can't think of three distinct variations for a category, that's a hint the feature is simpler than the framework expects — note "N/A: feature has only one X" in the matrix and move on. Don't fabricate filler.

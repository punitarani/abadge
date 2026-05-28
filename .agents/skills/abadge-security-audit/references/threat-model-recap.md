# Abadge Threat-Model Recap

Condensed reference for subagents. Adapted from `docs/SECURITY.md`, `docs/THREAT_MODEL.md`, and AGENTS.md's non-negotiable invariants.

## Mission

abadge is an **agent credential firewall**. Agents (human or AI) hold short-lived session tokens and explicit capabilities, and the system mediates every secret access with an immutable audit trail. Break any of the non-negotiable invariants and the firewall leaks.

## Non-negotiable invariants (security)

1. **Zero-knowledge for `zero_knowledge` profiles** — the server NEVER sees root keys or plaintext for ZK items. KDF, key unwrap, item encrypt/decrypt all client-side (browser, CLI, daemon).
2. **Server-managed items** — AES-256-GCM only. ENCRYPTION_KEY held by API worker; plaintext only in memory during decrypt.
3. **No plaintext secret storage.** Ciphertext at rest; hashed session tokens; hashed legacy API keys (only prefix stored plain for lookup).
4. **Explicit permission per access.** Row in `permissions` (agentId + itemId + capability) must exist and not be expired for every reveal/mount.
5. **Cross-org isolation is absolute.** No item/agent/audit row may be read across orgs. Every query filters on `orgId`.
6. **Append-only audit log.** `audit_logs` has no UPDATE/DELETE in application code. Every allowed AND denied access attempt is logged.
7. **Short-lived tokens.** `abs_` session 15 min; `abe_` bootstrap 10 min; `abc_` challenge 60s. Expiry enforced server-side.
8. **No wildcard permissions.** Each grant is exactly (agent, item, capability). No role that means "can read everything".
9. **Daemon secrets stay in memory.** No persistence. Socket 0600. Mount files 0600 in 0700 dirs. Auto-lock after 15 min inactivity.
10. **MCP never leaks plaintext to the LLM.** `mountId` is opaque. `run_with_secret` capture + redact + 4 KB cap.

A security finding that breaks any of these is Critical or High by default; the rubric decides which.

## Trust boundaries

```
Internet ─┬── Web (Next.js; cookie auth via Better Auth)
          └── Agent (SDK/CLI/MCP; bearer auth abs_* or legacy hash)
                              │
                      ┌───────┴────────┐
                      │  API worker     │ ← CLOUDFLARE WORKER boundary
                      │  (Hono + tRPC)  │
                      │  ENCRYPTION_KEY │
                      └───────┬────────┘
                              │ Hyperdrive
                              ▼
                      PlanetScale Postgres

Local machine ────────┬── CLI (user config ~/.abadge/)
                      │
                      ├── daemon (vaultd)
                      │   root key in memory only
                      │   Unix socket 0600
                      │   └── subprocess inject
                      │
                      └── MCP (stdio; agent auth)
```

Crossing a boundary means every assumption inside collapses unless explicitly re-verified. An API-worker-only invariant (e.g. "ENCRYPTION_KEY is in memory") doesn't protect against a daemon-side failure.

## Known threat classes (the Wave 2 catalogue)

Each has its own notes file under `notes/threat-*.md`. Subagents should take their W2 threat class and apply it systematically across every surface covered in Wave 1.

### Authentication boundary fall-through
- Can an unauthenticated request reach a privileged handler?
- Does the bearer resolver ever return an identity without checking enable/revoked status?
- Are `publicProcedure` endpoints actually public-safe?
- OAuth account linking (pre-claim takeover)?

### Authorization & capability
- Every `reveal`/`mount` checks (orgId, permission, capability)?
- Does any path skip the permission check (e.g. owner-reveal, ciphertext-read)?
- Org roles (owner/admin/member) — any endpoint that accepts member but should require admin?
- Last-owner guard on members.remove / updateRole?

### Cryptographic correctness
- AAD on AEAD modes — does ZK `xchacha20poly1305` bind the itemId? Does SM `aes-gcm`?
- KDF inputs — are Argon2id params enforced minimums? Is the salt unique per vault?
- Ed25519 — domain separation on signed messages?
- API-key compare — constant-time?
- Random quality — `crypto.getRandomValues` not `Math.random`?
- Nonce generation — 12-byte IV fresh per encrypt?

### Session token lifecycle
- Expiry enforced on every use?
- Revoke propagates to in-flight requests?
- Bearer fallback (manual findSession) doesn't bypass bearer plugin?
- Device code exchange atomic?
- Session tokens hashed before storage?

### Input validation
- Effect Schema applied at every boundary?
- Strict vs. passthrough mode — unknown fields rejected?
- MCP zod schemas match server schemas (no strip vs. strict mismatch)?
- Permission `expiresAt` validated as real date?
- JSON field sizes bounded?

### Information disclosure
- Error envelopes don't leak stack / SQL / key material?
- Enumeration — does checkSlug oracle presence? Does agent existence leak?
- Cache-Control on secret-bearing responses?
- DB errors pass through to client?

### Race conditions / TOCTOU
- Permission revoke vs. in-flight access?
- Agent revoke vs. in-flight access?
- `profiles.bootstrap` atomic? `changePassword` atomic?
- Mount file: perm check → open (TOCTOU window)?
- Daemon socket create: bind → chmod (TOCTOU window)?
- Challenge exchange: select → mark-used?

### Secret leakage
- MCP `run_with_secret` redaction regex complete? Long-secret bypass?
- Audit log `meta` field — does it echo user input?
- tRPC validation errors — do they echo values?
- Daemon decrypt error path — does it print snippet?
- CLI `run` — process.env passthrough?

### Rate limiting & DoS
- `/trpc/*` rate limit — per-IP or per-isolate?
- `createChallenge` unauth — table growth DoS?
- `profiles.bootstrap` — Argon2id memory/time pin?
- Payload size cap — where enforced?
- Daemon — connection cap, buffer cap?

### Supply chain
- Lockfile matches package.json?
- `"latest"` resolvers on any dep?
- GitHub Actions pinned to SHA vs. tag?
- Better Auth version pin vs. the CLI that runs migrations?
- Workspace-dep-on-private-package issues?

### Headers / cookies / CORS / CSP
- HSTS? X-Content-Type-Options? Referrer-Policy? COOP/CORP?
- Cookie flags (Secure, SameSite, __Host- prefix)?
- CORS trusted origins correct and minimal?
- CSP on the web dashboard?

### Audit log integrity
- Every allowed AND denied attempt logged?
- `safeAuditInsert` — silent failure mode?
- Unrecognized bearer — audited or silent?
- IP spoofability outside Cloudflare?
- Audit log migration / retention documented?
- Session-router denied paths — audited?

## Resolution-status cross-reference

Before filing a "new" finding, check:
- `docs/reviews/2026-04-14-full-stack-review.md` "Resolution status" table — many earlier findings are already ✅ Fixed
- `docs/security-audit/findings/` (if resuming a prior run) — the exact thing may already be filed

If a previously-fixed item is actually broken again, file as `Status: regression of <prior-id>` not `new`.

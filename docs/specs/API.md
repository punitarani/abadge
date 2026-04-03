# API Specification

> Canonical HTTP API reference. The API is the single source of truth for all operations.
> Every other surface (CLI, MCP, SDK) is a client of this API.

## Transport

The API exposes two parallel transports:

| Transport | Path | Use case |
|-----------|------|----------|
| **tRPC** | `/trpc/*` | Typed clients (SDK, web dashboard). Primary transport. |
| **REST v1** | `/v1/*` | Third-party integrations, agents, curl. Stable HTTP contract. |

Both transports share the same underlying procedures, domain logic, and error handling. The tRPC transport is the canonical implementation; REST v1 routes delegate to the same logic.

**Base URL:** Configured per environment (e.g., `https://api.abadge.dev`).

---

## Authentication

### Session Authentication (Human Users)

Used by: Dashboard, CLI, SDK.

| Method | Header |
|--------|--------|
| Cookie | Better Auth session cookie (set by `/api/auth/*`) |
| Bearer token | `Authorization: Bearer <session_token>` |

Session tokens are obtained via:
- `POST /api/auth/sign-up/email` — registration
- `POST /api/auth/sign-in/email` — login
- `GET /api/auth/get-session` — validate existing session

### Agent Authentication (Agents)

Used by: Registered agents accessing secrets via the `access.*` procedures.

| Method | Header |
|--------|--------|
| Bearer token | `Authorization: Bearer <api_key>` |

API key format: `abl_<secret>` (local) or `abg_<secret>` (remote).

**Verification flow:**
1. Extract prefix from token (first 8 chars).
2. Query DB for agents with matching `secretPrefix` (max 10 candidates).
3. SHA-256 hash the candidate token.
4. Constant-time comparison against stored `secretHash`.
5. Verify agent is `enabled` and `revokedAt` is null.
6. Update `lastUsedAt`.

---

## Rate Limiting

Per-IP, in-memory counters.

| Path pattern | Limit |
|--------------|-------|
| `/api/auth/*` | 60 requests / 60 seconds |
| `/trpc/*` | 100 requests / 60 seconds |
| `/v1/*` | 100 requests / 60 seconds |

Exceeded: `429 Too Many Requests` with `{ error: "Too many requests" }`.

---

## Common Response Patterns

### Success (single resource)

```json
{ "agent": { ... } }
```

### Success (list)

```json
{ "agents": [ ... ] }
```

### Success (mutation)

```json
{ "ok": true }
```

### Success (creation)

```json
{ "id": "uuid" }
```

### Error

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable description",
  "issues": [{ "path": ["field"], "message": "..." }]  // VALIDATION_ERROR only
}
```

See [DOMAIN.md — Error Codes](./DOMAIN.md#error-codes) for the full list.

---

## Procedures

### Health

```
GET /health
Auth: None
Response: { status: "ok" }
```

---

### Vault

All vault procedures require **session authentication**.

#### vault.bootstrap

Initialize the user's vault. Called once after account creation.

```
tRPC:  vault.bootstrap (mutation)
REST:  POST /v1/vault/bootstrap

Request:
{
  wrappedRootKey: string      // Root key wrapped by password-derived KEK
  kdfSalt: string             // Random salt for Argon2id
  kdfParams: {
    algorithm: "argon2id"
    memory: integer            // KiB
    iterations: integer
    parallelism: integer
    hashLength: integer
  }
}

Response: { id: string }

Errors:
  409 VAULT_ALREADY_EXISTS — user already has a vault
```

#### vault.get

Retrieve vault metadata (for client-side decryption setup).

```
tRPC:  vault.get (query)
REST:  GET /v1/vault

Response:
{
  vault: {
    id: string
    userId: string
    wrappedRootKey: string
    kdfSalt: string
    kdfParams: KdfParams
    recoveryWrappedRootKey: string | null
    keyVersion: integer
    createdAt: string
    updatedAt: string
  }
}

Errors:
  404 VAULT_NOT_FOUND — user has no vault
```

#### vault.changePassword

Re-wrap the root key with a new password-derived KEK. The root key itself does not change.

```
tRPC:  vault.changePassword (mutation)
REST:  POST /v1/vault/change-password

Request:
{
  wrappedRootKey: string      // Root key re-wrapped with new KEK
  kdfSalt: string             // New salt
  kdfParams: KdfParams        // New KDF parameters
}

Response: { ok: true }

Errors:
  404 VAULT_NOT_FOUND
```

#### vault.setupRecovery

Set a recovery key for the vault.

```
tRPC:  vault.setupRecovery (mutation)
REST:  POST /v1/vault/recovery

Request:
{
  recoveryWrappedRootKey: string   // Root key wrapped by recovery key
}

Response: { ok: true }

Errors:
  404 VAULT_NOT_FOUND
```

#### vault.rotateKey

Rotate the root key. Requires re-wrapping all item DEKs — the client must send the full set of re-encrypted item keys in one atomic operation.

```
tRPC:  vault.rotateKey (mutation)
REST:  POST /v1/vault/rotate-key

Request:
{
  wrappedRootKey: string                        // New root key, wrapped
  recoveryWrappedRootKey?: string               // Re-wrapped for recovery
  rekeyedItems: Record<itemId, encryptedItemKey> // Every ZK item, re-keyed
}

Response: { ok: true, keyVersion: integer }

Errors:
  404 VAULT_NOT_FOUND
```

**Design note:** This is an atomic DB transaction. If any item re-key fails, the entire operation rolls back. `keyVersion` is incremented exactly once.

---

### Items

All item procedures require **session authentication**.

#### items.create

Create a new encrypted item.

```
tRPC:  items.create (mutation)
REST:  POST /v1/items

Request (zero-knowledge):
{
  storageMode: "zero_knowledge"
  encryptedItemKey: string     // Per-item DEK wrapped by root key
  ciphertext: string           // XChaCha20-Poly1305 encrypted payload
}

Request (server-managed):
{
  storageMode: "server_managed"
  payload: {
    v: integer
    label: string
    kind: ItemKind
    tags: string[]
    notes?: string
    fields: Record<string, unknown>
  }
}

Response: { id: string }
```

#### items.list

List all items (metadata only — no ciphertext or payload).

```
tRPC:  items.list (query)
REST:  GET /v1/items

Response:
{
  items: Array<{
    id: string
    storageMode: "zero_knowledge" | "server_managed"
    cryptoVersion: integer
    contentVersion: integer
    createdAt: string
    updatedAt: string
  }>
}
```

#### items.get

Retrieve a single item. For ZK items, returns the encrypted blob. For server-managed items, returns metadata only (not the plaintext — use `access.reveal` for that).

```
tRPC:  items.get (query)
REST:  GET /v1/items/:itemId

Response (zero-knowledge):
{
  item: {
    id: string
    storageMode: "zero_knowledge"
    cryptoVersion: integer
    contentVersion: integer
    encryptedItemKey: string
    ciphertext: string
    createdAt: string
    updatedAt: string
  }
}

Response (server-managed):
{
  item: {
    id: string
    storageMode: "server_managed"
    cryptoVersion: integer
    contentVersion: integer
    createdAt: string
    updatedAt: string
  }
}

Errors:
  404 ITEM_NOT_FOUND
```

#### items.update

Update an item. Requires `contentVersion` for optimistic concurrency.

```
tRPC:  items.update (mutation)
REST:  PUT /v1/items/:itemId

Request (zero-knowledge):
{
  storageMode: "zero_knowledge"
  encryptedItemKey: string
  ciphertext: string
  contentVersion: integer        // Must match current version
}

Request (server-managed):
{
  storageMode: "server_managed"
  payload: ItemPayload
  contentVersion: integer
}

Response: { ok: true, contentVersion: integer }

Errors:
  404 ITEM_NOT_FOUND
  400 STALE_VERSION — contentVersion mismatch
```

#### items.delete

Soft-delete an item (sets `deletedAt`).

```
tRPC:  items.delete (mutation)
REST:  DELETE /v1/items/:itemId

Response: { ok: true }

Errors:
  404 ITEM_NOT_FOUND
```

---

### Agents

All agent procedures require **session authentication**.

#### agents.create

Register a new agent. Returns the API key exactly once.

```
tRPC:  agents.create (mutation)
REST:  POST /v1/agents

Request:
{
  kind: "device" | "local_cli" | "local_mcp" | "remote_agent"
  name: string (1-255 chars)
  metadata?: Record<string, unknown>
}

Response:
{
  agent: Agent
  apiKey: string              // Shown once, never retrievable again
}
```

**Critical UX requirement:** The API key MUST be displayed prominently to the user with a clear warning that it will not be shown again. All surfaces must enforce this.

#### agents.list

List all agents for the current user.

```
tRPC:  agents.list (query)
REST:  GET /v1/agents

Response:
{
  agents: Array<Agent>
}
```

#### agents.get

Retrieve a single agent.

```
tRPC:  agents.get (query)
REST:  GET /v1/agents/:agentId

Response: { agent: Agent }

Errors:
  404 AGENT_NOT_FOUND
```

#### agents.rotate

Rotate an agent's API key. The old key is invalidated immediately.

```
tRPC:  agents.rotate (mutation)
REST:  POST /v1/agents/:agentId/rotate

Response:
{
  apiKey: string              // New key, shown once
  keyPrefix: string           // Prefix for identification
}

Errors:
  404 AGENT_NOT_FOUND
```

#### agents.revoke

Revoke an agent. Sets `revokedAt` and `enabled = false`. The agent can no longer authenticate.

```
tRPC:  agents.revoke (mutation)
REST:  DELETE /v1/agents/:agentId

Response: { ok: true }

Errors:
  404 AGENT_NOT_FOUND
```

---

### Permissions

All permission procedures require **session authentication**.

#### permissions.create

Grant a capability to an agent for a specific item.

```
tRPC:  permissions.create (mutation)
REST:  POST /v1/permissions

Request:
{
  agentId: string
  itemId: string
  capability: Capability
  expiresAt?: string (ISO 8601)
}

Response: { permission: Permission }

Errors:
  404 AGENT_NOT_FOUND
  404 ITEM_NOT_FOUND
  400 INVALID_CAPABILITY — remote agent + ZK item, or remote agent + non-reveal capability
```

**Enforcement at creation time:** The API rejects permission grants that violate the capability access matrix. A remote agent cannot be granted `mount_env` on any item, nor any capability on a ZK item.

#### permissions.list

List permissions, optionally filtered by agent and/or item.

```
tRPC:  permissions.list (query)
REST:  GET /v1/permissions?agentId=...&itemId=...

Query params (all optional):
  agentId: string
  itemId: string

Response:
{
  permissions: Array<Permission>
}
```

#### permissions.revoke

Revoke a specific permission.

```
tRPC:  permissions.revoke (mutation)
REST:  DELETE /v1/permissions/:permissionId

Response: { ok: true }

Errors:
  404 PERMISSION_NOT_FOUND
```

---

### Access

All access procedures require **agent authentication** (Bearer token with API key).

These are the core credential access endpoints. They enforce the capability access matrix, check permission expiration, and log every attempt.

#### access.ciphertext

Read the encrypted blob of a zero-knowledge item for local decryption.

```
tRPC:  access.ciphertext (mutation)
REST:  POST /v1/access/ciphertext

Request:
{
  itemId: string
}

Response:
{
  encryptedItemKey: string
  ciphertext: string
  cryptoVersion: integer
}

Errors:
  403 FORBIDDEN — remote agent (locality check)
  400 BAD_REQUEST — item is not zero_knowledge
  403 PERMISSION_DENIED — no read_ciphertext permission
  403 PERMISSION_EXPIRED — permission expired
  404 ITEM_NOT_FOUND

Audit: access.ciphertext (allowed | denied | expired)
```

#### access.reveal

Decrypt and return the plaintext of a server-managed item.

```
tRPC:  access.reveal (mutation)
REST:  POST /v1/access/reveal

Request:
{
  itemId: string
}

Response:
{
  payload: {
    v: integer
    label: string
    kind: ItemKind
    tags: string[]
    notes?: string
    fields: Record<string, unknown>
  }
}

Errors:
  400 BAD_REQUEST — item is zero_knowledge (cannot reveal ZK items)
  403 PERMISSION_DENIED — no reveal_plaintext permission
  403 PERMISSION_EXPIRED
  404 ITEM_NOT_FOUND

Audit: access.reveal (allowed | denied | expired)
```

#### access.mount

Request item data for local injection (env var or temp file).

```
tRPC:  access.mount (mutation)
REST:  POST /v1/access/mount

Request:
{
  itemId: string
  mountType: "env" | "file"
}

Response (zero-knowledge):
{
  storageMode: "zero_knowledge"
  encryptedItemKey: string
  ciphertext: string
  cryptoVersion: integer
}

Response (server-managed):
{
  storageMode: "server_managed"
  payload: ItemPayload
}

Errors:
  403 FORBIDDEN — remote agent (locality check)
  403 PERMISSION_DENIED — no mount_env or mount_file permission
  403 PERMISSION_EXPIRED
  404 ITEM_NOT_FOUND

Audit: access.mount_env or access.mount_file (allowed | denied | expired)
```

**Design note:** For ZK items, the API returns the encrypted blob. The local agent must decrypt it using the daemon before injection. For server-managed items, the API decrypts and returns the plaintext directly.

---

### Audit

All audit procedures require **session authentication**.

#### audit.list

Query the audit log with optional filters and cursor-based pagination.

```
tRPC:  audit.list (query)
REST:  GET /v1/audit?eventType=...&result=...&agentId=...&itemId=...&cursor=...&limit=...

Query params (all optional):
  eventType: AuditEventType
  result: AuditResult
  agentId: string
  itemId: string
  cursor: string
  limit: integer (1-100, default 50)

Response:
{
  entries: Array<AuditEntry>
  nextCursor: string | null
}
```

---

### Better Auth Routes

Mounted at `/api/auth/*`. These are standard Better Auth endpoints.

```
POST /api/auth/sign-up/email   — Register with email + password
POST /api/auth/sign-in/email   — Login with email + password
POST /api/auth/sign-out        — Invalidate session
GET  /api/auth/get-session     — Validate current session
```

Social providers (Google, GitHub) are configured when the corresponding OAuth credentials are present in the environment.

---

## Middleware Stack

Applied in order for every request:

1. **Secure headers** — standard security headers (via `hono/secure-headers`)
2. **CORS** — configured trusted origins, methods: `GET POST PUT DELETE OPTIONS`
3. **Rate limiting** — per-IP counters with path-based limits
4. **Routing** — health check, Better Auth, tRPC adapter, REST v1 routes
5. **Auth middleware** (per-procedure):
   - `sessionProcedure` — resolves user from cookie or bearer session token
   - `agentProcedure` — resolves agent from bearer API key

---

## Design Decisions

### Why both tRPC and REST?

tRPC provides end-to-end type safety for first-party clients (SDK, dashboard). REST v1 provides a stable, discoverable HTTP contract for third-party integrations, agents using raw HTTP, and tools like curl. Both are thin layers over the same domain logic — there is no divergence.

### Why mutations for access endpoints?

`access.ciphertext`, `access.reveal`, and `access.mount` are mutations (POST), not queries, even though they read data. This is intentional: every access attempt has side effects (audit logging, `lastUsedAt` updates). Using mutations makes this explicit and prevents caching.

### Why no batch access endpoint?

Single-item access keeps the audit trail granular and the permission model simple. Batch access would require complex partial-success semantics and would blur the audit trail. If an agent needs multiple secrets, it makes multiple requests — each independently authorized and audited.

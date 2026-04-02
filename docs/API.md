# API Reference

The REST API is the canonical control plane for abadge. The dashboard, CLI, SDK, and integrations
all build on these routes.

Base URL: `https://your-api-domain` (local dev: `http://localhost:8787`)

## Authentication

### User sessions

Dashboard and management routes use Better Auth session cookies. Authenticate via:

```
POST /api/auth/sign-up/email   { name, email, password }
POST /api/auth/sign-in/email   { email, password }
GET  /api/auth/get-session
POST /api/auth/sign-out
```

Social login (when configured):

```
GET /api/auth/sign-in/social   { provider: "github" | "google" }
```

All `/v1/*` management routes require a valid session cookie unless noted otherwise.

### Social auth providers

```
GET /v1/auth/providers
```

Auth: none (public). Returns configured social login providers so the dashboard can render
available login options.

Response: `{ providers: ("github" | "google")[] }`

### Principal auth

Principal-facing routes (access endpoints) accept a Bearer token in the `Authorization` header:

```
Authorization: Bearer abg_...   (remote agent API key)
Authorization: Bearer abl_...   (local principal API key)
```

Lookup uses an 8-char prefix optimization, then constant-time SHA-256 hash verification.

---

## Vault

All routes require user session auth. Each user has one vault.

### Bootstrap vault

```
PUT /v1/vault/bootstrap
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wrappedRootKey` | string | yes | Root KEK encrypted by master password |
| `kdfSalt` | string | yes | Salt for Argon2id KDF |
| `kdfParams` | object | yes | `{ algorithm, memory, iterations, parallelism, hashLength }` |

Returns 409 if vault already exists.

Response: `{ id }` (201)

### Get vault

```
GET /v1/vault
```

Response: `{ id, wrappedRootKey, kdfSalt, kdfParams, recoveryWrappedRootKey, keyVersion, createdAt, updatedAt }`

The server never stores or returns the plaintext root key.

### Change password

```
POST /v1/vault/change-password
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wrappedRootKey` | string | yes | Root KEK re-wrapped with new password |
| `kdfSalt` | string | yes | New KDF salt |
| `kdfParams` | object | yes | New KDF parameters |

Response: `{ ok: true }`

### Setup recovery

```
POST /v1/vault/recovery/setup
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `recoveryWrappedRootKey` | string | yes | Root KEK wrapped with recovery key |

Response: `{ ok: true }`

### Rotate root key

```
POST /v1/vault/rotate-key
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wrappedRootKey` | string | yes | Root KEK wrapped with new key |
| `recoveryWrappedRootKey` | string | no | Recovery-wrapped root key (updated) |
| `rekeyedItems` | Record\<string, string> | yes | Map of itemId → new encryptedItemKey |

Response: `{ ok: true, keyVersion }`

---

## Items

All routes require user session auth.

### Create item

```
POST /v1/items
```

**Zero-knowledge mode:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storageMode` | `"zero_knowledge"` | yes | Storage mode |
| `encryptedItemKey` | string | yes | DEK wrapped by vault root key |
| `keyNonce` | string | yes | Nonce for key wrapping |
| `ciphertext` | string | yes | Encrypted payload |
| `contentNonce` | string | yes | Nonce for content encryption |

**Server-managed mode:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `storageMode` | `"server_managed"` | yes | Storage mode |
| `payload` | ItemPayload | yes | `{ v, label, kind, tags, notes, fields }` |

The server encrypts the payload with AES-256-GCM using the ENCRYPTION\_KEY environment variable.

Response: `{ id }` (201)

### List items

```
GET /v1/items
```

Response: `[{ id, storageMode, cryptoVersion, contentVersion, createdAt, updatedAt }]`

Metadata only. Never returns ciphertext or encrypted keys in list view.

### Get item

```
GET /v1/items/:id
```

**Zero-knowledge response:** `{ id, storageMode, encryptedItemKey, keyNonce, ciphertext, contentNonce, cryptoVersion, contentVersion, createdAt, updatedAt }`

**Server-managed response:** `{ id, storageMode, cryptoVersion, contentVersion, createdAt, updatedAt }`

Server-managed items do not return ciphertext in GET -- use the access routes.

### Update item

```
PUT /v1/items/:id
```

Same fields as create, plus:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contentVersion` | integer | yes | Must match current version (optimistic concurrency) |

Returns 409 if contentVersion does not match.

Response: `{ ok: true, contentVersion }`

### Delete item

```
DELETE /v1/items/:id
```

Soft delete (sets `deletedAt` timestamp).

Response: `{ ok: true }`

---

## Principals

All routes require user session auth.

### Register principal

```
POST /v1/principals
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | enum | yes | `device`, `local_cli`, `local_mcp`, `remote_agent` |
| `name` | string | yes | Display name |
| `metadata` | object | no | Arbitrary metadata |

Response: `{ principal: { id, kind, locality, name, ... }, secret: "abg_..." or "abl_..." }` (201)

The secret is shown **once**. Only the SHA-256 hash and 8-char prefix are stored.

### List principals

```
GET /v1/principals
```

Response: `[{ id, userId, kind, locality, name, secretPrefix, enabled, revokedAt, lastUsedAt, metadata, createdAt }]`

Never returns `secretHash`.

### Get principal

```
GET /v1/principals/:id
```

Response: Single principal object (same fields as list).

### Rotate API key

```
POST /v1/principals/:id/rotate
```

Invalidates the old key immediately and generates a new one.

Response: `{ secret, secretPrefix }`

### Revoke principal

```
POST /v1/principals/:id/revoke
```

Sets `revokedAt` and `enabled=false`.

Response: `{ ok: true }`

---

## Grants

All routes require user session auth.

### Create grant

```
POST /v1/grants
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `principalId` | string | yes | Principal to grant access to |
| `itemId` | string | yes | Item to grant access to |
| `capability` | enum | yes | `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`, `use_without_reveal` |
| `expiresAt` | ISO date | no | Grant expiration |

Both principal and item must belong to the authenticated user. Returns 409 if the grant already
exists (unique on principalId + itemId + capability).

**Capability matrix enforcement:**

* Remote principals cannot access zero-knowledge items (400)
* Remote principals can only have `reveal_plaintext` capability (400)
* Local principals can have any capability on any storage mode

Response: `{ id }` (201)

### List grants

```
GET /v1/grants
```

| Query param | Type | Description |
|-------------|------|-------------|
| `principalId` | string | Filter by principal |
| `itemId` | string | Filter by item |

Response: `[{ id, principalId, itemId, capability, expiresAt, grantedBy, createdAt }]`

### Revoke grant

```
DELETE /v1/grants/:id
```

Response: `{ ok: true }`

---

## Access (Principal-facing)

All routes require principal auth (Bearer token). These are the routes principals use to access
item data.

### Access ciphertext

```
POST /v1/access/ciphertext
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | Item to access |

Returns the encrypted item key and ciphertext for local decryption via daemon.

**Requirements:**
* Principal locality must be `local`
* Item storageMode must be `zero_knowledge`
* Grant must exist with capability `read_ciphertext`
* Grant must not be expired

Response: `{ encryptedItemKey, ciphertext, cryptoVersion }`

Denied: 403 (no grant or wrong locality)

### Access reveal

```
POST /v1/access/reveal
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | Item to access |

Server decrypts and returns the plaintext payload.

**Requirements:**
* Item storageMode must be `server_managed`
* Grant must exist with capability `reveal_plaintext`
* Grant must not be expired

Response: `{ payload: { v, label, kind, tags, notes, fields } }`

Denied: 403 (no grant), 400 (wrong storage mode)

### Access mount

```
POST /v1/access/mount
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | Item to access |
| `mountType` | enum | yes | `env` or `file` |

Returns item data for local mounting (env injection or file write).

**Requirements:**
* Principal locality must be `local`
* Grant must exist with capability `mount_env` or `mount_file` (matching mountType)
* Grant must not be expired

**Zero-knowledge response:** `{ storageMode, encryptedItemKey, ciphertext }`

**Server-managed response:** `{ storageMode, payload }`

Denied: 403

---

## Audit Log

Requires user session auth.

### Query audit log

```
GET /v1/audit
```

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | number (max 200) | Results per page (default: 50) |
| `cursor` | string | Cursor from previous page (audit log entry ID) |
| `eventType` | string | Filter by event type (e.g., `access.reveal`, `item.create`) |
| `result` | enum | `allowed`, `denied`, `expired`, `revoked` |
| `principalId` | string | Filter by principal |
| `itemId` | string | Filter by item |

Pagination is cursor-based, descending by ID.

Response: `{ entries: AuditEntry[], nextCursor: string | null }`

**Audit entry fields:** `id`, `userId`, `principalId`, `itemId`, `eventType`, `result`,
`deliveryMode`, `meta`, `ipAddress`, `occurredAt`

---

## Event Types

| Category | Events |
|----------|--------|
| Vault | `vault.bootstrap`, `vault.unlock`, `vault.password_change`, `vault.key_rotate` |
| Item | `item.create`, `item.read`, `item.update`, `item.delete` |
| Principal | `principal.create`, `principal.rotate`, `principal.revoke` |
| Grant | `grant.create`, `grant.revoke` |
| Access | `access.ciphertext`, `access.reveal`, `access.mount_env`, `access.mount_file` |

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `INVALID_API_KEY` | 401 | API key is invalid or revoked |
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation |
| `NOT_FOUND` | 404 | Resource does not exist or is not owned by this user |
| `CONFLICT` | 409 | Duplicate resource (vault, grant) or contentVersion mismatch |
| `RATE_LIMITED` | 429 | Too many requests |
| `ACCESS_DENIED` | 403 | No matching grant, wrong locality, or wrong capability |

---

## Health Check

```
GET /health
```

Response: `{ "status": "ok" }`

---

## Rate Limiting

| Path pattern | Limit |
|-------------|-------|
| `/api/auth/*` | 60 requests per 60 seconds |
| `/v1/*` | 100 requests per 60 seconds |

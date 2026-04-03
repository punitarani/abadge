# Domain Model Specification

> Canonical reference for all shared types, entities, capabilities, and invariants.
> Every surface (API, CLI, MCP, SDK) projects this model — none may contradict it.

## Entities

### Vault

One per user. Holds the wrapped root key for zero-knowledge encryption.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| userId | string | Owner (FK → user) |
| wrappedRootKey | string | Root key wrapped by password-derived KEK |
| kdfSalt | string | Salt for Argon2id derivation |
| kdfParams | KdfParams | Argon2id tuning parameters |
| recoveryWrappedRootKey | string \| null | Root key wrapped by recovery key |
| keyVersion | integer (≥1) | Incremented on each key rotation |
| createdAt | ISO 8601 | Creation timestamp |
| updatedAt | ISO 8601 | Last modification timestamp |

**Invariants:**
- Exactly one vault per user (unique index on userId).
- The server never possesses the unwrapped root key.
- `keyVersion` is monotonically increasing and never resets.

### Item

A secret stored in the vault. Supports two storage modes with fundamentally different trust properties.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| userId | string | Owner (FK → user) |
| vaultId | string \| null | Associated vault (FK → vault) |
| storageMode | StorageMode | `zero_knowledge` or `server_managed` |
| cryptoVersion | integer (≥1) | Envelope format version |
| contentVersion | integer (≥1) | Optimistic concurrency token |
| createdAt | ISO 8601 | Creation timestamp |
| updatedAt | ISO 8601 | Last modification timestamp |
| deletedAt | ISO 8601 \| null | Soft-delete timestamp |

**Zero-knowledge fields** (null when `server_managed`):

| Field | Type | Description |
|-------|------|-------------|
| encryptedItemKey | string | Per-item DEK wrapped by root key |
| ciphertext | string | XChaCha20-Poly1305 encrypted payload |

**Server-managed fields** (null when `zero_knowledge`):

| Field | Type | Description |
|-------|------|-------------|
| serverCiphertext | string | AES-256-GCM encrypted payload |
| serverIv | string | 12-byte IV (base64) |
| serverKeyVersion | integer | Encryption key version |

**Invariants:**
- An item is always exactly one storage mode; it cannot change after creation.
- Zero-knowledge items: the server never sees plaintext. All crypto happens client-side (browser or daemon).
- Server-managed items: the server encrypts/decrypts using AES-256-GCM with a worker-held key.
- `contentVersion` must match on updates (optimistic concurrency control).
- Deletion is soft (sets `deletedAt`), preserving audit trail integrity.

### ItemPayload

The structured plaintext content of an item. This is what gets encrypted.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| v | integer | yes | Payload schema version |
| label | string (1+) | yes | Human-readable name |
| kind | ItemKind | yes | Secret type classification |
| tags | string[] | yes | Categorization tags |
| notes | string | no | Free-form notes |
| fields | Record\<string, unknown\> | yes | The actual secret data (key-value pairs) |

**Design decision:** `fields` is an untyped record because secret shapes vary wildly across kinds (login has username+password, certificate has PEM data, API key has a single token, etc.). Validation of field structure is left to clients, not the server — the server treats `fields` as opaque JSON.

### Agent

An identity that can request access to items. Agents are either local (same machine as the user) or remote (external service, CI, cloud function).

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| userId | string | Owner who registered this agent |
| kind | AgentKind | Classification (determines locality) |
| locality | AgentLocality | Derived: `local` or `remote` |
| name | string (1-255) | Human-readable label |
| keyPrefix | string \| null | First characters of hashed API key |
| enabled | boolean | Whether the agent can authenticate |
| revokedAt | ISO 8601 \| null | When revoked (null = active) |
| lastUsedAt | ISO 8601 \| null | Last successful authentication |
| metadata | Record\<string, unknown\> | Arbitrary key-value data |
| createdAt | ISO 8601 | Registration timestamp |

**Invariants:**
- API keys are SHA-256 hashed before storage. The plaintext key is shown exactly once at creation time and is never retrievable.
- `locality` is derived from `kind` and cannot be set directly.
- A revoked agent (`revokedAt != null`) cannot authenticate.
- Key rotation invalidates the old key immediately.

### Permission

A specific grant of one capability from one agent to one item.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| agentId | string | The agent receiving access (FK → agent) |
| itemId | string | The item being accessed (FK → item) |
| capability | Capability | What the agent can do |
| expiresAt | ISO 8601 \| null | Optional expiration (null = permanent) |
| createdBy | string | User who granted this permission |
| createdAt | ISO 8601 | Grant timestamp |

**Invariants:**
- Unique constraint on (agentId, itemId, capability) — no duplicate grants.
- Expired permissions are checked at access time and result in `PERMISSION_EXPIRED`.
- Remote agents may only hold `reveal_plaintext` on `server_managed` items.
- Local agents may hold any capability on any storage mode.
- No wildcard permissions exist.

### AuditEntry

An immutable record of every access attempt and management operation.

| Field | Type | Description |
|-------|------|-------------|
| id | bigint | Auto-incrementing identifier |
| userId | string | User context |
| agentId | string \| null | Agent involved (null for user-initiated) |
| itemId | string \| null | Item involved (null for non-item events) |
| eventType | AuditEventType | What happened |
| result | AuditResult | Outcome |
| deliveryMode | string \| null | How the secret was delivered |
| meta | Record\<string, unknown\> | Event-specific metadata |
| ipAddress | string \| null | Client IP |
| occurredAt | ISO 8601 | When it happened |

**Invariants:**
- Append-only. No updates or deletes — ever.
- No foreign key constraints (audit survives entity deletion).
- Both allowed and denied attempts are logged.

---

## Enums and Constants

### StorageMode

| Value | Description |
|-------|-------------|
| `zero_knowledge` | Client-side encryption. Server stores opaque ciphertext. **Default for CLI.** |
| `server_managed` | Server-side AES-256-GCM encryption. Server can decrypt on authorized request. |

**Design decision:** `zero_knowledge` is the recommended default. It provides the strongest security guarantee — even a full server breach cannot expose plaintext. `server_managed` exists for use cases where remote agents need access or where the user does not want to manage a local daemon.

### ItemKind

| Value | Description |
|-------|-------------|
| `login` | Username + password combination |
| `api_key` | Single API key or token |
| `token` | OAuth token, JWT, or session token |
| `json` | Arbitrary JSON blob |
| `certificate` | TLS/SSL certificate or PEM data |
| `ssh_key` | SSH private/public key pair |
| `opaque` | Unstructured binary or text secret |

### AgentKind

| Value | Locality | Description |
|-------|----------|-------------|
| `device` | `local` | A physical device (laptop, server) |
| `local_cli` | `local` | The abadge CLI tool |
| `local_mcp` | `local` | An MCP server running locally |
| `remote_agent` | `remote` | An external service, CI runner, or cloud function |

**Locality derivation rule:** `device`, `local_cli`, `local_mcp` → `local`. `remote_agent` → `remote`. This is enforced at creation time and cannot be overridden.

### Capability

| Value | Scope | Description |
|-------|-------|-------------|
| `read_ciphertext` | ZK items, local agents only | Read the encrypted blob for local decryption |
| `reveal_plaintext` | Server-managed items | Decrypt and return plaintext via API |
| `mount_env` | Both modes, local agents only | Inject secret into subprocess environment variable |
| `mount_file` | Both modes, local agents only | Write secret to temporary file (0600 permissions) |
| `use_without_reveal` | Both modes | Use the secret without ever seeing it (future: OAuth proxy, form fill) |

### Capability Access Matrix

This is the core authorization table. It defines what is possible given an agent's locality and an item's storage mode.

| Capability | Local + ZK | Local + Server | Remote + ZK | Remote + Server |
|------------|-----------|---------------|------------|----------------|
| `read_ciphertext` | **Allowed** | Denied | **Denied** | Denied |
| `reveal_plaintext` | Denied | **Allowed** | **Denied** | **Allowed** |
| `mount_env` | **Allowed** | **Allowed** | **Denied** | Denied |
| `mount_file` | **Allowed** | **Allowed** | **Denied** | Denied |
| `use_without_reveal` | **Allowed** | **Allowed** | **Denied** | **Allowed** |

**Key rules:**
1. Remote agents can never access ZK items (they cannot decrypt).
2. Remote agents can only use `reveal_plaintext` or `use_without_reveal` on server-managed items.
3. `read_ciphertext` only makes sense for ZK items (returns encrypted blob for local decryption).
4. `reveal_plaintext` only makes sense for server-managed items (server must decrypt).
5. `mount_env` and `mount_file` require a local runtime to inject/write the secret.

### AuditEventType

**Vault lifecycle:**
| Value | Triggered by |
|-------|-------------|
| `vault.bootstrap` | Vault creation |
| `vault.unlock` | Daemon unlock |
| `vault.password_change` | Password change |
| `vault.key_rotate` | Root key rotation |

**Item lifecycle:**
| Value | Triggered by |
|-------|-------------|
| `item.create` | Item creation |
| `item.read` | Item retrieval (by owner) |
| `item.update` | Item update |
| `item.delete` | Item soft-delete |

**Agent lifecycle:**
| Value | Triggered by |
|-------|-------------|
| `agent.create` | Agent registration |
| `agent.rotate` | API key rotation |
| `agent.revoke` | Agent revocation |

**Permission lifecycle:**
| Value | Triggered by |
|-------|-------------|
| `permission.create` | Permission grant |
| `permission.revoke` | Permission revocation |

**Access events** (agent-initiated):
| Value | Triggered by |
|-------|-------------|
| `access.ciphertext` | Agent reads encrypted blob |
| `access.reveal` | Agent reads plaintext |
| `access.mount_env` | Agent requests env injection |
| `access.mount_file` | Agent requests file mount |

### AuditResult

| Value | Description |
|-------|-------------|
| `allowed` | Access granted and data returned |
| `denied` | Access denied (no permission or wrong capability) |
| `expired` | Permission existed but has expired |
| `revoked` | Agent or permission was revoked |

### API Key Prefixes

| Prefix | Meaning |
|--------|---------|
| `abl_` | Local agent API key |
| `abg_` | Remote agent API key |

---

## Error Codes

Every error response includes a machine-readable `code` field. Surfaces may format the error differently (JSON body, CLI stderr, MCP error), but the code is always one of these.

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BAD_REQUEST` | 400 | Malformed request |
| `VALIDATION_ERROR` | 400 | Schema validation failure (includes `issues` array) |
| `INVALID_CAPABILITY` | 400 | Capability not allowed for this agent/item combination |
| `STALE_VERSION` | 400 | `contentVersion` mismatch on item update |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `AGENT_REVOKED` | 401 | Agent is revoked and cannot authenticate |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `PERMISSION_DENIED` | 403 | No matching permission for this capability |
| `PERMISSION_EXPIRED` | 403 | Permission exists but has expired |
| `NOT_FOUND` | 404 | Generic resource not found |
| `VAULT_NOT_FOUND` | 404 | User has no vault |
| `ITEM_NOT_FOUND` | 404 | Item does not exist or belongs to another user |
| `AGENT_NOT_FOUND` | 404 | Agent does not exist or belongs to another user |
| `PERMISSION_NOT_FOUND` | 404 | Permission does not exist |
| `CONFLICT` | 409 | Resource already exists |
| `VAULT_ALREADY_EXISTS` | 409 | User already has a vault |
| `RATE_LIMITED` | 429 | Too many requests |

### Error Response Shape

```typescript
{
  code: ErrorCode;
  message: string;
  issues?: Array<{ path: (string | number)[]; message: string }>; // VALIDATION_ERROR only
}
```

---

## Encryption

### Zero-Knowledge (Client-Side)

| Property | Value |
|----------|-------|
| Algorithm | XChaCha20-Poly1305 |
| KDF | Argon2id |
| Key hierarchy | Master password → KEK → Root key → Per-item DEK → Payload |
| Key wrapping | Root key wrapped by KEK, stored as `wrappedRootKey` |
| Item encryption | Each item has a unique DEK; DEK wrapped by root key |
| Trust boundary | Plaintext never leaves browser/daemon memory |

### Server-Managed (Server-Side)

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM (WebCrypto) |
| Key source | `ENCRYPTION_KEY` worker secret (32 bytes, base64) |
| IV | 12 random bytes per encryption |
| Storage | Base64 ciphertext + IV + key version |
| Trust boundary | Server can decrypt; plaintext returned only to authorized agents |

---

## Pagination

All list endpoints that may return large result sets use cursor-based pagination:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string \| undefined | undefined | Opaque cursor from previous response |
| `limit` | integer (1-100) | 50 | Maximum items per page |

Response includes:

| Field | Type | Description |
|-------|------|-------------|
| `nextCursor` | string \| null | Pass as `cursor` for the next page. `null` = no more pages. |

**Currently paginated:** `audit.list`. Other list endpoints (items, agents, permissions) are unpaginated for v1 — they return all results. Pagination will be added when needed.

---

## Naming Conventions

| Concept | Code name | API name | CLI name |
|---------|-----------|----------|----------|
| Secret | Item | `item` / `items` | `item` |
| Agent identity | Agent / Principal | `agent` / `agents` | `agent` |
| Access grant | Permission / Grant | `permission` / `permissions` | `permission` |
| Secret vault | Vault | `vault` | `vault` |
| Access log | Audit | `audit` | `audit` |

**Design decision:** The codebase uses "principal" and "grant" internally (DB table names), but all external interfaces use "agent" and "permission" for clarity. The specs and all user-facing surfaces use the external names exclusively.

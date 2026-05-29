# Domain Model Specification

> Canonical reference for all shared types, entities, capabilities, and invariants.
> Every surface (API, CLI, MCP, SDK) projects this model -- none may contradict it.

## Entities

### Profile

Named credential namespace within an org. Each profile has its own encryption root.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| organizationId | string | Owning org (FK → organization) |
| name | string | Human-readable name (unique per org) |
| description | string \| null | Optional description |
| storageMode | StorageMode | `zero_knowledge` or `server_managed` |
| wrappedRootKey | string \| null | Root key wrapped by password-derived KEK |
| kdfSalt | string \| null | Salt for Argon2id derivation |
| kdfParams | KdfParams \| null | Argon2id tuning parameters |
| recoveryWrappedRootKey | string \| null | Root key wrapped by recovery key |
| keyVersion | integer (>=1) | Incremented on each key rotation |
| createdAt | ISO 8601 | Creation timestamp |
| updatedAt | ISO 8601 | Last modification timestamp |

**Invariants:**
- Unique constraint on `(organizationId, name)`.
- The server never possesses the unwrapped root key for ZK profiles.
- `keyVersion` is monotonically increasing and never resets.
- A profile cannot be deleted if it has non-deleted items.

### Item

A stored credential within a profile. Supports two storage modes with fundamentally different trust properties.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| organizationId | string | Owning org (FK → organization) |
| profileId | string | Parent profile (FK → profile) |
| label | string | Human-readable name (cleartext, required) |
| kind | ItemKind | Secret type classification |
| tags | string[] | Categorization tags |
| storageMode | StorageMode | `zero_knowledge` or `server_managed` |
| cryptoVersion | integer (>=1) | Envelope format version |
| contentVersion | integer (>=1) | Optimistic concurrency token |
| createdAt | ISO 8601 | Creation timestamp |
| updatedAt | ISO 8601 | Last modification timestamp |
| deletedAt | ISO 8601 \| null | Soft-delete timestamp |

**Zero-knowledge fields** (null when `server_managed`):

| Field | Type | Description |
|-------|------|-------------|
| encryptedItemKey | string | Per-item DEK wrapped by root key (nonce prepended in first 24 bytes) |
| ciphertext | string | XChaCha20-Poly1305 encrypted payload |
| contentNonce | string | Nonce for content encryption |

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

### Agent

An automated caller scoped to an org. Agents are either local (same machine as the user) or remote (external service, CI, cloud function).

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| organizationId | string | Owning org (FK → organization) |
| createdBy | string | User who registered this agent |
| kind | AgentKind | Classification (determines locality) |
| locality | AgentLocality | Derived: `local` or `remote` |
| name | string (1-255) | Human-readable label |
| description | string \| null | Optional description |
| authMethod | AuthMethod | `public_key_session` (only value; default) |
| publicKey | string \| null | Ed25519 public key (session auth) |
| enabled | boolean | Whether the agent can authenticate |
| revokedAt | ISO 8601 \| null | When revoked (null = active) |
| lastUsedAt | ISO 8601 \| null | Last successful authentication |
| metadata | Record\<string, unknown\> | Arbitrary key-value data |
| createdAt | ISO 8601 | Registration timestamp |

**Invariants:**
- `authMethod` is always `public_key_session`; agents authenticate only via Ed25519 keypair → `abs_` session tokens.
- The private key never leaves the agent host; the server stores only the public key.
- `locality` is derived from `kind` and cannot be set directly.
- A revoked agent (`revokedAt != null`) cannot authenticate.
- Revoking an agent invalidates its active sessions immediately. To replace a keypair, revoke and re-enroll.

### UserApiKey

A personal API key (prefix `abu_`) bound to a `(user, org)` pair. Authenticates the management surface as the issuing user.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| userId | string | Owning user (FK → user, ON DELETE cascade) |
| organizationId | string | Scoped org (FK → organization, ON DELETE cascade) |
| name | string | Human-readable label |
| secretHash | string | SHA-256 hash of the `abu_...` secret |
| secretPrefix | string | First 8 characters of the secret for lookup |
| enabled | boolean | Whether the key can authenticate |
| revokedAt | ISO 8601 \| null | When revoked (null = active) |
| expiresAt | ISO 8601 \| null | Optional expiration (null = no expiry) |
| lastUsedAt | ISO 8601 \| null | Last successful authentication |
| metadata | Record\<string, unknown\> | Arbitrary key-value data |
| createdAt | ISO 8601 | Creation timestamp |

**Invariants:**
- The secret is shown exactly once at creation. The server stores only the SHA-256 hash + prefix.
- Resolves to a **session identity**, not an agent. It reaches only the `sessionProcedure` management surface and can **never** reach the agent-gated `access.*` surface — it cannot reveal or mount secret values.
- A personal API key cannot create or revoke other API keys (that requires a real browser session).

### Permission

A specific grant of one capability from one agent to one item.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier |
| organizationId | string | Owning org (FK → organization) |
| agentId | string | The agent receiving access (FK → agent) |
| itemId | string | The item being accessed (FK → item) |
| capability | Capability | What the agent can do |
| expiresAt | ISO 8601 \| null | Optional expiration (null = permanent) |
| grantedBy | string | User who granted this permission |
| createdAt | ISO 8601 | Grant timestamp |

**Invariants:**
- Unique constraint on `(agentId, itemId, capability)` -- no duplicate permissions.
- Expired permissions are checked at access time and result in `PERMISSION_EXPIRED`.
- No wildcard permissions exist.

### AuditEntry

An immutable record of every access attempt and management operation.

| Field | Type | Description |
|-------|------|-------------|
| id | bigint | Auto-incrementing identifier |
| organizationId | string | Org context |
| userId | string \| null | User context |
| agentId | string \| null | Agent involved (null for user-initiated) |
| itemId | string \| null | Item involved (null for non-item events) |
| profileId | string \| null | Profile involved |
| surface | string \| null | `cli`, `mcp`, `api`, `sdk` |
| eventType | AuditEventType | What happened |
| result | AuditResult | Outcome |
| deliveryMode | string \| null | How the secret was delivered |
| field | string \| null | Specific field accessed |
| purpose | string \| null | Caller-declared purpose |
| meta | Record\<string, unknown\> | Event-specific metadata |
| ipAddress | string \| null | Client IP |
| occurredAt | ISO 8601 | When it happened |

**Invariants:**
- Append-only. No updates or deletes -- ever.
- No foreign key constraints (audit survives entity deletion).
- Both allowed and denied attempts are logged.

---

## Enums and Constants

### StorageMode

| Value | Description |
|-------|-------------|
| `zero_knowledge` | Client-side encryption. Server stores opaque ciphertext. |
| `server_managed` | Server-side AES-256-GCM encryption. Server can decrypt on authorized request. |

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

### Standard Fields by Kind

| Kind | Standard fields |
|---|---|
| `login` | `username`, `email`, `password`, `url`, `totp_secret` |
| `api_key` | `value` (default), `key_id`, `key_secret` |
| `token` | `value` |
| `certificate` | `cert`, `key`, `chain`, `passphrase` |
| `ssh_key` | `private_key`, `public_key`, `passphrase` |
| `json` | user-defined |
| `opaque` | `value` |

This table is defined in `packages/core/src/constants.ts` as `STANDARD_FIELDS_BY_KIND`.

### AgentKind

| Value | Locality | Description |
|-------|----------|-------------|
| `local_cli` | `local` | The abadge CLI tool |
| `local_mcp` | `local` | An MCP server running locally |
| `remote` | `remote` | An external service, CI runner, or cloud function |

### Capability

| Value | Description |
|-------|-------------|
| `read_ciphertext` | Read the encrypted blob for local decryption (ZK items, local agents only) |
| `reveal_plaintext` | Decrypt and return plaintext via API (server-managed items only) |
| `mount_env` | Inject secret into subprocess environment variable (local agents only) |
| `mount_file` | Write secret to temporary file with 0600 permissions (local agents only) |

### Capability Access Matrix

This is the core authorization table. It defines what is possible given an agent's locality and an item's storage mode.

| Capability | Local + ZK | Local + Server | Remote + ZK | Remote + Server |
|---|---|---|---|---|
| `read_ciphertext` | **Allowed** | **Denied** | **Denied** | **Denied** |
| `reveal_plaintext` | **Denied** | **Allowed** | **Denied** | **Allowed** |
| `mount_env` | **Allowed** | **Allowed** | **Denied** | **Denied** |
| `mount_file` | **Allowed** | **Allowed** | **Denied** | **Denied** |

**Key rules:**
1. Remote agents can never access ZK items (they cannot decrypt).
2. Remote agents can only use `reveal_plaintext` on server-managed items.
3. `read_ciphertext` only makes sense for ZK items (returns encrypted blob for local decryption).
4. `reveal_plaintext` only makes sense for server-managed items (server must decrypt).
5. `mount_env` and `mount_file` require a local runtime to inject/write the secret.

### AuditEventType

**Profile lifecycle:**

| Value | Triggered by |
|-------|-------------|
| `profile.create` | Profile creation |
| `profile.rotate` | Password change or root-key rotation |
| `profile.delete` | Direct profile deletion |
| `profile.delete_cascade` | Profile deletion as a downstream cascade |

**Item lifecycle:**

| Value | Triggered by |
|-------|-------------|
| `item.create` | Item creation |
| `item.export` | Owner export / reveal of item material |
| `item.update` | Item update |
| `item.delete` | Item soft-delete |
| `item.delete_cascade` | Item deletion as a downstream cascade |

**Agent lifecycle:**

| Value | Triggered by |
|-------|-------------|
| `agent.create` | Agent registration |
| `agent.bootstrap_issue` | Bootstrap token issued |
| `agent.enroll` | Agent enrollment (public key set) |
| `agent.revoke` | Agent revocation |
| `agent.revoke_cascade` | Agent revocation as a downstream cascade |
| `agent.session_issue` | Session token issued |
| `agent.session_reject` | Session exchange rejected |
| `agent.session_revoke` | Session revoked |

**API key lifecycle:**

| Value | Triggered by |
|-------|-------------|
| `user_api_key.create` | Personal API key created |
| `user_api_key.revoke` | Personal API key revoked |

**Permission lifecycle:**

| Value | Triggered by |
|-------|-------------|
| `permission.create` | Permission grant |
| `permission.revoke` | Permission revocation |
| `permission.revoke_cascade` | Permission revocation as a downstream cascade |

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
| `cascade` | Downstream effect of another operation |

### Token Prefixes

| Prefix | Meaning |
|--------|---------|
| `abu_` | Personal API key (user + org; management surface, session identity) |
| `abs_` | Agent session token (only credential that reaches `access.*`) |
| `abe_` | Agent enrollment bootstrap token |
| `abc_` | Agent session challenge |

---

## Organization RBAC

Three roles enforced in API middleware on every mutating call.

| Action | Owner | Admin | Member |
|---|---|---|---|
| Manage org settings, plan, delete org | Yes | No | No |
| Invite / remove members, change roles | Yes | Yes | No |
| Create / delete profiles | Yes | Yes | No |
| Unlock / bootstrap / change password on profiles | Yes | Yes | Yes (if they have the profile password) |
| Create / update / soft-delete items | Yes | Yes | Yes (in profiles they have access to) |
| Create / revoke agents | Yes | Yes | Yes |
| Create / revoke permissions | Yes | Yes | Yes (**only on agents they created**) |
| View audit logs for any user in the org | Yes | Yes | No |
| View their own audit entries | Yes | Yes | Yes |

**Key rules:**
- Members can only grant permissions to agents they created. This prevents a member from escalating a shared deployment agent's access.
- Audit visibility is role-scoped. Owners and admins see the full org log. Members see only entries where they are the actor or where they created the agent that acted.

RBAC is enforced by `requireRole(orgParam, minRole)` middleware. Agent ownership is enforced by `requireAgentOwnership(agentIdParam)` on `permissions.create` when the caller is a member.

---

## Field Delivery Model

Items contain a `fields` object with named key-value pairs. The `field` parameter on access methods selects a specific field for delivery.

**Resolution rules (via `resolveFieldValue`):**
- If `field` is specified, return that field's value. Error `FIELD_NOT_FOUND` if it does not exist.
- If `field` is omitted and the item has exactly one field, return that field's value.
- If `field` is omitted and the item has multiple fields, error `MULTI_FIELD_ITEM` listing available fields.
- `--expand-env` on the CLI expands all fields into env vars (`FIELDNAME=VALUE`).

**Audit implications:** Every access request records the `field` that was delivered (or `"__default__"` if no field was named, or `"__expand__"` for collection expansion).

---

## Cascading Behavior

Revocation and deletion have explicit, documented effects on dependent state. Every cascade writes an audit entry with `result = "cascade"`.

### Agent revoked
- All active `agentSessions` are marked `revokedAt = now` immediately
- Permissions remain in the database (for audit) but are treated as inactive
- Future access attempts return `AGENT_REVOKED`
- One audit event per invalidated session

### Item soft-deleted
- `deletedAt` is set; the `label` is preserved for audit readability
- Active file mounts are released by the daemon on its next housekeeping tick
- Future access attempts return `ITEM_DELETED`
- Permissions referencing the deleted item remain and show as "inactive"

### Profile deleted
- Only allowed if the profile has no non-deleted items (returns `PROFILE_NOT_EMPTY` otherwise)
- Soft-delete cascades to permissions (marked inactive) but does not touch already-soft-deleted items

### Member removed from org
- The member loses access to all org resources immediately
- Agents they created remain in the org and are not auto-revoked
- Permissions they granted remain valid (the grant outlives the granter)
- Their audit entries are preserved

---

## Error Codes

Every error response includes `{ code, message, hint, meta? }`. The `hint` is always an actionable next step.

| Code | HTTP Status | Description | Hint (example) |
|------|-------------|-------------|----------------|
| `BAD_REQUEST` | 400 | Malformed request | -- |
| `VALIDATION_ERROR` | 400 | Schema validation failure (includes `issues` array) | -- |
| `INVALID_CAPABILITY_LOCALITY` | 400 | Capability incompatible with agent locality | `Remote agents cannot use <cap>. Use reveal_plaintext, or register a local agent.` |
| `INVALID_CAPABILITY_STORAGE` | 400 | Capability incompatible with item storage mode | `read_ciphertext requires a zero-knowledge item. Use reveal_plaintext for server-managed items.` |
| `STALE_VERSION` | 400 | `contentVersion` mismatch on item update | -- |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication | -- |
| `AGENT_REVOKED` | 401 | Agent is revoked and cannot authenticate | `Register a new agent: abadge agent register --name <name> --kind <kind>` |
| `SESSION_EXPIRED` | 401 | Human session has expired | `Run: abadge login` |
| `BOOTSTRAP_TOKEN_EXPIRED` | 401 | Enrollment token has expired | `Issue a fresh bootstrap token for the agent and re-enroll.` |
| `FORBIDDEN` | 403 | Authenticated but not authorized | -- |
| `PERMISSION_DENIED` | 403 | No matching permission for this capability | `Run: abadge permission create --agent <name> --item <label> --capability <cap>` |
| `PERMISSION_EXPIRED` | 403 | Permission exists but has expired | -- |
| `MEMBER_INSUFFICIENT_ROLE` | 403 | Role does not permit action | `This action requires the <required> role. Ask an org owner to promote you.` |
| `MEMBER_AGENT_OWNERSHIP` | 403 | Cannot grant permissions on an agent you don't own | `Members can only grant permissions to agents they created. Ask an admin to run this command.` |
| `NOT_FOUND` | 404 | Generic resource not found | -- |
| `ITEM_NOT_FOUND` | 404 | Item does not exist or belongs to another org | -- |
| `ITEM_DELETED` | 404 | Item was soft-deleted | `The item "<label>" was deleted on <date>. Recreate it or restore from backup.` |
| `AGENT_NOT_FOUND` | 404 | Agent does not exist or belongs to another org | -- |
| `PERMISSION_NOT_FOUND` | 404 | Permission does not exist | -- |
| `FIELD_NOT_FOUND` | 404 | Named field not present in item | `Available fields on "<label>": username, password. Did you mean --field password?` |
| `MULTI_FIELD_ITEM` | 400 | Item has multiple fields; none selected | `Specify --field <name>. Available: username, password.` |
| `PROFILE_NOT_EMPTY` | 400 | Profile still has non-deleted items | `Delete all items in the profile first: abadge item list --profile <name>` |
| `DAEMON_NOT_RUNNING` | 503 | Local daemon is not listening | `Start it with: abadge daemon start` |
| `PROFILE_LOCKED` | 403 | Profile has no unlocked key in daemon | `Run: abadge profile unlock` |
| `CONFLICT` | 409 | Resource already exists | -- |
| `RATE_LIMITED` | 429 | Too many requests | -- |

### Error Response Shape

```typescript
{
  code: string;         // machine-readable error code
  message: string;      // one-line human description
  hint: string;         // actionable next step
  meta?: Record<string, unknown>;  // structured context
  issues?: Array<{ path: (string | number)[]; message: string }>;  // VALIDATION_ERROR only
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

Response includes `nextCursor: string | null`. Pass as `cursor` for the next page. `null` means no more pages.

**Currently paginated:** `audit.list`. Other list endpoints are unpaginated for v1.

---

## Naming Conventions

| Concept | DB table | API/SDK name | CLI name |
|---------|----------|--------------|----------|
| Credential namespace | `profiles` | `profile` / `profiles` | `profile` |
| Secret | `items` | `item` / `items` | `item` |
| Agent identity | `agents` | `agent` / `agents` | `agent` |
| Access grant | `permissions` | `permission` / `permissions` | `permission` |
| Access log | `auditLogs` | `audit` | `audit` |

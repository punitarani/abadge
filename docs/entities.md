# Entities & Data Model

Complete reference for all database entities, relationships, and data lifecycle in abadge.

---

## Entity Relationship Diagram

```
Organization
  ├── Members (Users with roles: owner, admin, member)
  ├── Profiles (named credential namespaces, each with ZK or server-managed encryption)
  │     └── Items (individual credentials, each with named fields)
  └── Agents (automated callers scoped to the org)
        └── Permissions → Items (with Capabilities)

AuditLog (append-only, org-scoped, records everything)
```

---

## Organization

Top-level resource owner. Everything belongs to an organization. Personal workspace = org with one member.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Unique org ID |
| `name` | text | NOT NULL | Display name |
| `slug` | text | NOT NULL, UNIQUE | URL slug |
| `logo` | text | nullable | Logo URL |
| `createdAt` | timestamptz | NOT NULL | Creation time |

---

## Profile

Named credential namespace within an org. Replaces the single vault-per-user model. Each profile has its own encryption root.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Profile ID |
| `organizationId` | text | FK → organization, NOT NULL | Owning org |
| `name` | text | NOT NULL | Human-readable name |
| `description` | text | nullable | Optional description |
| `storageMode` | text | NOT NULL | `zero_knowledge` or `server_managed` |
| `wrappedRootKey` | text | nullable | Root key encrypted by KEK (XChaCha20-Poly1305) |
| `kdfSalt` | text | nullable | Argon2id salt (16 bytes, base64) |
| `kdfParams` | jsonb | nullable | `{algorithm, memory, iterations, parallelism, hashLength}` |
| `recoveryWrappedRootKey` | text | nullable | Root key encrypted by recovery key |
| `keyVersion` | integer | NOT NULL, default `1` | Incremented on root key rotation |
| `createdAt` | timestamptz | NOT NULL | Creation time |
| `updatedAt` | timestamptz | NOT NULL | Last update |

**Unique constraint**: `(organizationId, name)` -- one profile name per org.

---

## Item

Stored credential within a profile. Two storage modes: zero_knowledge (client-side XChaCha20-Poly1305) and server_managed (AES-256-GCM).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Item ID |
| `organizationId` | text | FK → organization, NOT NULL | Owning org |
| `profileId` | text | FK → profile, NOT NULL | Parent profile |
| `label` | text | NOT NULL | Human-readable name (cleartext) |
| `kind` | text | NOT NULL | `login`, `api_key`, `token`, `json`, `certificate`, `ssh_key`, `opaque` |
| `tags` | jsonb | NOT NULL, default `[]` | Categorization tags |
| `storageMode` | text | NOT NULL | `zero_knowledge` or `server_managed` |
| `encryptedItemKey` | text | nullable | DEK wrapped by root key, nonce prepended (ZK only) |
| `ciphertext` | text | nullable | Payload encrypted by DEK (ZK only) |
| `contentNonce` | text | nullable | Nonce for content encryption (ZK only) |
| `serverCiphertext` | text | nullable | AES-256-GCM ciphertext (server-managed only) |
| `serverIv` | text | nullable | 12-byte IV (server-managed only) |
| `serverKeyVersion` | integer | nullable | Encryption key version (server-managed only) |
| `cryptoVersion` | integer | NOT NULL, default `1` | Envelope format version |
| `contentVersion` | integer | NOT NULL, default `1` | Optimistic concurrency counter |
| `deletedAt` | timestamptz | nullable | Soft-delete timestamp |
| `createdAt` | timestamptz | NOT NULL | Creation time |
| `updatedAt` | timestamptz | NOT NULL | Last update |

**Plaintext envelope** (what gets encrypted):
```json
{
  "v": 1,
  "label": "prod postgres",
  "kind": "login",
  "tags": ["prod", "db"],
  "notes": "Primary production database",
  "fields": { "host": "db.example.com", "password": "s3cret" }
}
```

---

## Agent

Automated caller scoped to an org. Kinds: local_cli, local_mcp, remote.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Agent ID |
| `organizationId` | text | FK → organization, NOT NULL | Owning org |
| `createdBy` | text | FK → user, NOT NULL | User who registered this agent |
| `name` | text | NOT NULL | Human-readable name |
| `description` | text | nullable | Optional description |
| `kind` | text | NOT NULL | `local_cli`, `local_mcp`, `remote` |
| `locality` | text | NOT NULL | `local` or `remote` (derived from kind) |
| `authMethod` | text | NOT NULL | `public_key_session` or `legacy_api_key` |
| `publicKey` | text | nullable | Ed25519 public key (session auth) |
| `secretHash` | text | nullable | SHA-256 hash of API key (legacy auth) |
| `secretPrefix` | text | nullable | First chars for fast lookup |
| `enabled` | boolean | NOT NULL, default `true` | Whether agent can authenticate |
| `revokedAt` | timestamptz | nullable | Revocation timestamp |
| `lastUsedAt` | timestamptz | nullable | Last successful auth |
| `metadata` | jsonb | NOT NULL, default `{}` | Arbitrary metadata |
| `createdAt` | timestamptz | NOT NULL | Creation time |

**Locality mapping**: `local_cli`, `local_mcp` → `local`. `remote` → `remote`.

---

## Permission

Explicit capability grant: agent + item + capability. Unique constraint on (agentId, itemId, capability).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Permission ID |
| `organizationId` | text | FK → organization, NOT NULL | Owning org |
| `agentId` | text | FK → agent, NOT NULL | Agent receiving access |
| `itemId` | text | FK → item, NOT NULL | Item being accessed |
| `capability` | text | NOT NULL | `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file` |
| `expiresAt` | timestamptz | nullable | Auto-expiration |
| `grantedBy` | text | FK → user, NOT NULL | User who created the permission |
| `createdAt` | timestamptz | NOT NULL | Creation time |

**Unique constraint**: `(agentId, itemId, capability)` -- one permission per agent-item-capability triple.

---

## Audit Log

Append-only, no FK constraints. Survives entity deletion.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | bigserial | PK | Auto-incrementing ID |
| `organizationId` | text | NOT NULL | Org context |
| `userId` | text | nullable | User context |
| `agentId` | text | nullable | Agent involved (if any) |
| `itemId` | text | nullable | Item involved (if any) |
| `profileId` | text | nullable | Profile involved (if any) |
| `surface` | text | nullable | `cli`, `mcp`, `api`, `sdk` |
| `eventType` | text | NOT NULL | Event category |
| `result` | text | NOT NULL | `allowed`, `denied`, `expired`, `revoked`, `cascade` |
| `deliveryMode` | text | nullable | How the secret was delivered |
| `field` | text | nullable | Specific field accessed |
| `purpose` | text | nullable | Caller-declared purpose |
| `meta` | jsonb | NOT NULL, default `{}` | Structured metadata |
| `ipAddress` | text | nullable | Client IP |
| `occurredAt` | timestamptz | NOT NULL, default `now()` | Event timestamp |

**Event types**:

| Category | Events |
|---|---|
| Profile | `profile.create`, `profile.rotate`, `profile.delete`, `profile.delete_cascade` |
| Item | `item.create`, `item.export`, `item.update`, `item.delete`, `item.delete_cascade` |
| Auth | `auth.login`, `auth.logout`, `auth.token_issue`, `auth.token_revoke` |
| Agent | `agent.create`, `agent.bootstrap_issue`, `agent.enroll`, `agent.rotate`, `agent.revoke`, `agent.revoke_cascade`, `agent.session_issue`, `agent.session_reject`, `agent.session_revoke` |
| Permission | `permission.create`, `permission.revoke`, `permission.revoke_cascade` |
| Access | `access.ciphertext`, `access.reveal`, `access.mount_env`, `access.mount_file` |

---

## Auth & Organization Entities

### Session (Better Auth)

| Column | Type | Description |
|---|---|---|
| `id` | text | PK |
| `token` | text | UNIQUE session token |
| `expiresAt` | timestamptz | Session expiration (7 days) |
| `userId` | text | FK → user |
| `ipAddress` | text | Client IP |
| `userAgent` | text | Browser user agent |
| `activeOrganizationId` | text | Active org context |

### Member

| Column | Type | Description |
|---|---|---|
| `id` | text | PK |
| `organizationId` | text | FK → organization |
| `userId` | text | FK → user |
| `role` | text | `owner`, `admin`, or `member` |

### Device Code

| Column | Type | Description |
|---|---|---|
| `id` | text | PK |
| `deviceCode` | text | UNIQUE device code |
| `userCode` | text | UNIQUE user-facing code |
| `userId` | text | FK → user (set after approval) |
| `status` | text | `pending`, `approved`, `denied` |
| `expiresAt` | timestamptz | Code expiration |

---

## Agent Session Entities

### Agent Session

Short-lived authentication token for agents using public-key auth.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Session ID |
| `agentId` | text | FK → agent, NOT NULL | Agent this session belongs to |
| `userId` | text | FK → user, NOT NULL | Agent's owner |
| `tokenHash` | text | NOT NULL, UNIQUE | SHA-256 hash of `abs_...` token |
| `expiresAt` | timestamptz | NOT NULL | Expiration (default: 15 minutes) |
| `revokedAt` | timestamptz | nullable | Revocation timestamp |
| `lastUsedAt` | timestamptz | nullable | Last use |
| `createdAt` | timestamptz | NOT NULL | Creation time |

### Agent Session Challenge

One-time challenge for agent session exchange (Ed25519 signature verification).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Challenge ID |
| `agentId` | text | FK → agent, NOT NULL | Target agent |
| `challengeHash` | text | NOT NULL, UNIQUE | SHA-256 hash of challenge |
| `expiresAt` | timestamptz | NOT NULL | Expiration (1 minute) |
| `usedAt` | timestamptz | nullable | When used |
| `createdAt` | timestamptz | NOT NULL | Creation time |

### Agent Enrollment Token

One-time bootstrap token for agent enrollment (public key registration).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Token ID |
| `agentId` | text | FK → agent, NOT NULL | Target agent |
| `userId` | text | FK → user, NOT NULL | Agent's owner |
| `createdBy` | text | FK → user, NOT NULL | Issuer |
| `tokenHash` | text | NOT NULL, UNIQUE | SHA-256 hash of `abe_...` token |
| `expiresAt` | timestamptz | NOT NULL | Expiration (10 minutes) |
| `usedAt` | timestamptz | nullable | When used |
| `createdAt` | timestamptz | NOT NULL | Creation time |

---

## Token & Prefix Reference

| Token | Prefix | TTL | Storage | Purpose |
|---|---|---|---|---|
| Agent session | `abs_` | 15 minutes | SHA-256 hash | Short-lived access token |
| Bootstrap token | `abe_` | 10 minutes | SHA-256 hash | One-time agent enrollment |
| Challenge | `abc_` | 1 minute | SHA-256 hash | Signature verification |
| Local API key | `abl_` | None | SHA-256 hash + prefix | Legacy local agent auth |
| Remote API key | `abg_` | None | SHA-256 hash + prefix | Legacy remote agent auth |

---

## Data Lifecycle

### Item Lifecycle

```
[Created] → item.create
  │
  ├── [Updated] → item.update (contentVersion++)
  │
  └── [SoftDeleted] → item.delete (deletedAt set, data retained)
```

### Agent Lifecycle

```
[Created] → agent.create
  │
  ├── [Enrolled] → agent.enroll (public key set)
  │     └── [Active] → session exchanged
  │
  ├── [Active] → API key issued (legacy)
  │     └── [KeyRotated] → agent.rotate → [Active]
  │
  └── [Revoked] → agent.revoke (revokedAt set, enabled = false)
```

### Permission Lifecycle

```
[Active] → permission.create
  │
  ├── [Expired] → expiresAt passed
  │
  └── [Revoked] → permission.revoke
```

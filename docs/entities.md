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
        └── Permissions → Item OR Profile (with Capabilities: read, use)

AuditLog (append-only, org-scoped, records everything)
```

---

## Organization

Top-level resource owner and isolation boundary. Everything (profiles, items, agents, permissions, audit) belongs to an organization. (Better Auth table.)

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Unique org ID |
| `name` | text | NOT NULL | Display name |
| `slug` | text | NOT NULL, UNIQUE | URL slug |
| `logo` | text | nullable | Logo URL |
| `metadata` | text | nullable | JSON blob. `{"type":"personal"}` marks a personal workspace (`PERSONAL_ORG_METADATA` / `isPersonalOrg`). No dedicated column. |
| `createdAt` | timestamptz | NOT NULL | Creation time |

A **personal account** is a normal single-member org flagged via `metadata`. It is capped at a single profile (`profiles.create` rejects a second profile with `PROFILE_LIMIT_EXCEEDED`; the cap is an `≤ 1` existence check). Team orgs are uncapped. Creating any org auto-seeds one default `server_managed` profile (name and `externalId` both `"default"`) in the same transaction, so a fresh org is immediately usable.

---

## Profile

Named credential namespace within an org; the encryption boundary. Each profile has its own root key (ZK) or server-managed DEK.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Profile ID |
| `organizationId` | text | FK → organization, NOT NULL, ON DELETE cascade | Owning org |
| `name` | text | NOT NULL | Human-readable name |
| `description` | text | nullable | Optional description |
| `externalId` | text | nullable | Optional caller-supplied identifier for idempotent provisioning |
| `storageMode` | text | NOT NULL | `zero_knowledge` or `server_managed` |
| `wrappedRootKey` | text | nullable | Root key encrypted by KEK (XChaCha20-Poly1305; ZK only) |
| `kdfSalt` | text | nullable | Argon2id salt (16 bytes, base64; ZK only) |
| `kdfParams` | jsonb | nullable | `{algorithm, memory, iterations, parallelism, hashLength}` (ZK only) |
| `recoveryWrappedRootKey` | text | nullable | Root key encrypted by recovery key (ZK only) |
| `serverWrappedDek` | text | nullable | Per-profile AES-256-GCM DEK wrapped under `ENCRYPTION_KEY` (server_managed only; NULL until first v3 write) |
| `serverEncryptionCount` | bigint | NOT NULL, default `0` | Running count of AES-256-GCM encryptions under this profile's DEK (nonce-reuse warning at 2^27) |
| `keyVersion` | integer | NOT NULL, default `1` | Incremented on root key rotation |
| `createdAt` | timestamptz | NOT NULL | Creation time |
| `updatedAt` | timestamptz | NOT NULL | Last update |

**Unique constraints**: `(organizationId, name)` -- one profile name per org; partial `(organizationId, externalId)` where `externalId` is not null.

---

## Item

Stored credential within a profile. Two storage modes: zero_knowledge (client-side XChaCha20-Poly1305) and server_managed (AES-256-GCM).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Item ID |
| `organizationId` | text | FK → organization, NOT NULL, ON DELETE cascade | Owning org (the isolation boundary) |
| `profileId` | text | FK → profile, nullable, ON DELETE set null | Parent profile |
| `createdBy` | text | FK → user, nullable, ON DELETE set null | User who created the row (audit metadata, not ownership) |
| `label` | text | NOT NULL | Human-readable name (cleartext) |
| `kind` | text | nullable | `login`, `api_key`, `token`, `json`, `certificate`, `ssh_key`, `opaque` |
| `tags` | jsonb | NOT NULL, default `[]` | Categorization tags |
| `storageMode` | text | NOT NULL | `zero_knowledge` or `server_managed` |
| `encryptedItemKey` | text | nullable | DEK wrapped by root key; the 24-byte XChaCha20-Poly1305 wrap nonce is prepended into its first bytes (ZK only). There is **no** separate `keyNonce` column. |
| `ciphertext` | text | nullable | Payload encrypted by DEK; the 24-byte content nonce is prepended into its first bytes (ZK only). There is **no** separate `contentNonce` column. |
| `serverCiphertext` | text | nullable | AES-256-GCM ciphertext (server_managed only) |
| `serverIv` | text | nullable | 12-byte IV (server_managed only) |
| `serverKeyVersion` | integer | nullable | Encryption key version; also the AAD-epoch marker (1 = legacy no-AAD, ≥2 = AAD-bound, ≥3 = per-profile DEK) (server_managed only) |
| `cryptoVersion` | integer | NOT NULL, default `1` | Envelope format version |
| `contentVersion` | integer | NOT NULL, default `1` | Optimistic concurrency counter |
| `deletedAt` | timestamptz | nullable | Soft-delete timestamp |
| `createdAt` | timestamptz | NOT NULL | Creation time |
| `updatedAt` | timestamptz | NOT NULL | Last update |

**Indexes**: `organizationId`, `profileId`, `createdBy`, and a partial `(organizationId, createdAt, id) WHERE deleted_at IS NULL` for the active-item keyset list.

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
| `organizationId` | text | FK → organization, NOT NULL, ON DELETE cascade | Owning org |
| `createdBy` | text | FK → user, nullable, ON DELETE set null | User who registered the agent; SET NULL orphans the agent rather than deleting it (§AB-0043) |
| `name` | text | NOT NULL | Human-readable name |
| `description` | text | nullable | Optional description |
| `kind` | text | NOT NULL | `local_cli`, `local_mcp`, `remote` |
| `locality` | text | NOT NULL | `local` or `remote` (derived from kind) |
| `authMethod` | text | NOT NULL | `public_key_session` (only value) |
| `publicKey` | text | nullable | Ed25519 public key (session auth) |
| `enabled` | boolean | NOT NULL, default `true` | Whether agent can authenticate |
| `revokedAt` | timestamptz | nullable | Revocation timestamp |
| `lastUsedAt` | timestamptz | nullable | Last successful auth |
| `metadata` | jsonb | NOT NULL, default `{}` | Arbitrary metadata |
| `createdAt` | timestamptz | NOT NULL | Creation time |

**Locality mapping**: `local_cli`, `local_mcp` → `local`. `remote` → `remote`.

---

## User API Key

Personal API key (prefix `abu_`) bound to a `(user, org)` pair. Authenticates the management surface as the issuing user; resolves to a session identity, never an agent. Created, listed, and revoked from the dashboard org Settings page. No foreign keys to org-scoped tenant tables — RLS-exempt like `agents`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Key ID |
| `userId` | text | FK → user, NOT NULL, ON DELETE cascade | Owning user |
| `organizationId` | text | FK → organization, NOT NULL, ON DELETE cascade | Scoped org |
| `name` | text | NOT NULL | Human-readable label |
| `secretHash` | text | NOT NULL | SHA-256 hash of the `abu_...` secret |
| `secretPrefix` | text | NOT NULL | First 8 chars for fast lookup |
| `enabled` | boolean | NOT NULL, default `true` | Whether the key can authenticate |
| `revokedAt` | timestamptz | nullable | Revocation timestamp |
| `expiresAt` | timestamptz | nullable | Optional expiration |
| `lastUsedAt` | timestamptz | nullable | Last successful auth |
| `metadata` | jsonb | NOT NULL, default `{}` | Arbitrary metadata |
| `createdAt` | timestamptz | NOT NULL | Creation time |

**Security**: the secret is shown exactly once at creation. The server stores only the hash + prefix. The key reaches only the `sessionProcedure` management surface — it can never reach the agent-gated `access.*` surface and cannot create or revoke other API keys.

---

## Permission

Explicit capability grant: agent + target + capability. A permission targets **either** a single item **or** a whole profile, never both. A profile-target grant covers every item currently in the profile and every item added later.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Permission ID |
| `organizationId` | text | FK → organization, NOT NULL, ON DELETE cascade | Owning org |
| `agentId` | text | FK → agent, NOT NULL, ON DELETE cascade | Agent receiving access |
| `itemId` | text | FK → item, nullable, ON DELETE cascade | Item target (null when `profileId` is set) |
| `profileId` | text | FK → profile, nullable, ON DELETE cascade | Profile target (null when `itemId` is set) |
| `capability` | text | NOT NULL | Canonical `read` or `use`; legacy `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file` still accepted and stored as-is |
| `expiresAt` | timestamptz | nullable | Auto-expiration |
| `grantedBy` | text | FK → user, nullable, ON DELETE set null | User who created the grant; SET NULL so a grant outlives its granter (§AB-0043) |
| `createdAt` | timestamptz | NOT NULL | Creation time |

**Capabilities**: `read` (read the plaintext, or the ZK envelope to decrypt locally) and `use` (reserve a mount handle the local daemon injects via env var or `0600` temp file). The legacy four-capability set maps to canonical via `LEGACY_TO_CANONICAL` (`read_ciphertext`/`reveal_plaintext` → `read`; `mount_env`/`mount_file` → `use`).

**Exactly-one-target**: a CHECK constraint enforces that exactly one of `itemId`, `profileId` is non-null.

**Unique constraints**: partial `(agentId, itemId, capability)` where `itemId IS NOT NULL`; partial `(agentId, profileId, capability)` where `profileId IS NOT NULL`.

**Indexes**: `organizationId`, `agentId`, `itemId`, `profileId`.

**Runtime constraints** (enforced at grant-create and at access time, not encoded in the capability name):

| Agent locality | Item storage | `read` | `use` |
|---|---|---|---|
| local | server_managed | allowed | allowed |
| local | zero_knowledge | allowed | allowed |
| remote | server_managed | allowed | denied (no local daemon) |
| remote | zero_knowledge | denied (server cannot decrypt) | denied |

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
| Profile | `profile.create`, `profile.read`, `profile.bootstrap`, `profile.rotate`, `profile.delete`, `profile.delete_cascade`, `profile.setup_recovery` |
| Item | `item.create`, `item.read`, `item.update`, `item.delete`, `item.delete_cascade`, `item.export` |
| Auth | `auth.login`, `auth.logout`, `auth.signup`, `auth.token_issue`, `auth.token_revoke` |
| Account (auth.md) | `account.register`, `account.claim`, `account.claim_complete` |
| Org | `org.create`, `org.read`, `org.update`, `org.delete`, `org.member_add`, `org.member_list`, `org.member_remove`, `org.member_role_change`, `org.invite`, `org.invite_accept`, `org.invite_reject`, `org.invite_revoke` |
| Agent | `agent.create`, `agent.bootstrap_issue`, `agent.enroll`, `agent.revoke`, `agent.revoke_cascade`, `agent.session_issue`, `agent.session_reject`, `agent.session_revoke` |
| API key | `user_api_key.create`, `user_api_key.revoke`, `user_api_key.expire` |
| Permission | `permission.create`, `permission.revoke`, `permission.revoke_cascade` |
| Access | `access.ciphertext`, `access.reveal`, `access.mount_env`, `access.mount_file` |

The canonical `read` action audits as `access.reveal`; the canonical `use` action audits as `access.mount_env` or `access.mount_file` depending on delivery. `access.ciphertext` is emitted only by the legacy ciphertext endpoint. `agent.rotate` is a historical event retained for querying old rows; no current code writes it.

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
| `agentId` | text | FK → agent, NOT NULL, ON DELETE cascade | Agent this session belongs to |
| `userId` | text | FK → user, nullable, ON DELETE set null | Agent's owner (null if creator deleted) |
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
| `userId` | text | FK → user, nullable, ON DELETE set null | Agent's owner (null if creator deleted) |
| `createdBy` | text | FK → user, NOT NULL, ON DELETE cascade | Issuer |
| `tokenHash` | text | NOT NULL, UNIQUE | SHA-256 hash of `abe_...` token |
| `expiresAt` | timestamptz | NOT NULL | Expiration (10 minutes) |
| `usedAt` | timestamptz | nullable | When used |
| `createdAt` | timestamptz | NOT NULL | Creation time |

### Mount Reservation

Short-lived handle minted by the `use` action. `access.use` / `access.useProfile` return an opaque `mountId` (prefix `mnt_`) that the local daemon redeems for the decrypted material. The file path is never returned to the caller.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Reservation ID |
| `mountId` | text | NOT NULL, UNIQUE | Opaque handle (prefix `mnt_`) returned to the caller |
| `itemId` | text | FK → item, NOT NULL, ON DELETE cascade | Item bound to this handle |
| `agentId` | text | FK → agent, NOT NULL, ON DELETE cascade | Agent that reserved the mount |
| `delivery` | text | NOT NULL | `env` or `file` |
| `field` | text | nullable | Specific field to deliver |
| `envVarName` | text | nullable | Env var name for `env` delivery |
| `expiresAt` | timestamptz | NOT NULL | Expiration (default: 5 minutes) |
| `consumedAt` | timestamptz | nullable | Set when the daemon redeems the handle (prevents replay) |
| `createdAt` | timestamptz | NOT NULL | Creation time |

---

## Account Claim (auth.md)

One-time record for the anonymous agentic-registration flow: an agent self-registers a placeholder personal account that a human later claims via emailed OTP. Looked up by hashed `clm_` token before any org context, so RLS-exempt like `user_api_keys`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Claim ID |
| `organizationId` | text | FK → organization, NOT NULL, ON DELETE cascade | The unclaimed personal org |
| `userId` | text | FK → user, NOT NULL, ON DELETE cascade | The placeholder user being claimed |
| `claimTokenHash` | text | NOT NULL, UNIQUE | SHA-256 hash of the `clm_...` claim token |
| `email` | text | nullable | Email bound at claim time |
| `otpHash` | text | nullable | SHA-256 hash of the 6-digit OTP |
| `otpExpiresAt` | timestamptz | nullable | OTP lifetime (10 minutes) |
| `otpAttempts` | integer | NOT NULL, default `0` | Bounded verification attempts (max 5) |
| `status` | text | NOT NULL, default `pending` | `pending` → `otp_sent` → `claimed` |
| `expiresAt` | timestamptz | NOT NULL | Claim lifetime (24 hours) |
| `usedAt` | timestamptz | nullable | When the claim completed |
| `createdAt` | timestamptz | NOT NULL | Creation time |

Expired-unclaimed rows are GC'd opportunistically, which drops the placeholder account and its org.

---

## Token & Prefix Reference

| Token | Prefix | TTL | Storage | Purpose |
|---|---|---|---|---|
| Agent session | `abs_` | 15 minutes | SHA-256 hash | Short-lived agent access token (only credential that reaches `access.*`) |
| Personal API key | `abu_` | Optional expiry | SHA-256 hash + prefix | User-owned management-surface key (session identity, never `access.*`) |
| Bootstrap token | `abe_` | 10 minutes | SHA-256 hash | One-time agent enrollment |
| Challenge | `abc_` | 1 minute | SHA-256 hash | Signature verification |
| Mount handle | `mnt_` | 5 minutes | Plaintext row (single-use) | Opaque `use`-action handle the daemon redeems |
| Invite token | `abi_` | 7 days | SHA-256 hash | One-time org invitation |
| Claim token | `clm_` | 24 hours | SHA-256 hash | auth.md anonymous-account claim |

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
  │     └── [Active] → session exchanged (abs_ token)
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

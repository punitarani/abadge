# Security Model

## Core rules

The current control plane enforces these invariants:

* no plaintext credential storage
* no plaintext principal API-key storage
* no decrypt-before-auth
* no cross-user item access
* every allowed and denied access attempt is audited
* remote principals cannot read ciphertext or use mount delivery
* zero-knowledge plaintext stays in browser or daemon memory

## Encryption modes

### Zero-knowledge items

The browser or daemon performs the cryptographic work.

* root key is wrapped by the user password
* item payload is encrypted client-side
* server stores wrapped item keys and ciphertext
* server never receives plaintext item data

The API can return ciphertext for authorized local principals, but it does not decrypt that data.

### Server-managed items

The API worker encrypts and decrypts payloads with AES-256-GCM.

* key source: Worker secret `ENCRYPTION_KEY`
* IV: random 12-byte nonce
* ciphertext, IV, and key version are stored in Postgres
* decrypt only happens after authorization checks pass

## Authentication

### Session callers

Session procedures are backed by Better Auth.

Accepted identities:

* dashboard cookie sessions
* raw Better Auth session tokens presented as `Authorization: Bearer ...`

### Principal callers

Principal procedures require Bearer tokens with the stored principal prefix and hash model:

* `abl_` for local principals
* `abg_` for remote principals

Verification order:

1. candidate lookup by `secretPrefix`
2. constant-time hash verification
3. legacy Better Auth API-key fallback

Successful principal authentication updates `lastUsedAt`.

## Authorization flow

Principal access procedures all follow the same order:

1. authenticate the principal
2. load the target item for the principal's owning user
3. verify grant existence for the exact capability
4. reject expired grants
5. enforce locality and storage-mode constraints
6. audit the attempt
7. decrypt only if the capability and storage mode permit it

Denied requests are audited before returning an error.

## Capability enforcement

| Principal locality | Zero-knowledge item | Server-managed item |
|-------------------|---------------------|---------------------|
| local | `read_ciphertext`, `mount_env`, `mount_file` | `reveal_plaintext`, `mount_env`, `mount_file` |
| remote | denied | `reveal_plaintext` only |

Current grant creation also blocks:

* remote principal grants on zero-knowledge items
* remote grants for capabilities other than `reveal_plaintext`

## Audit logging

The audit log is append-only.

Each entry may include:

* `userId`
* `principalId`
* `itemId`
* `eventType`
* `result`
* `deliveryMode`
* `meta`
* `ipAddress`
* `occurredAt`

The access router writes audit events for both allowed and denied outcomes.

## Transport protections

The Hono worker shell applies:

* secure headers
* explicit CORS handling
* rate limiting on `/api/auth/*` and `/trpc/*`

Current limits:

| Path pattern | Limit |
|-------------|-------|
| `/api/auth/*` | 60 requests per 60 seconds |
| `/trpc/*` | 100 requests per 60 seconds |

## Storage summary

| Data | Stored form |
|------|-------------|
| vault root key | wrapped key only |
| zero-knowledge item value | ciphertext only |
| server-managed item value | AES-256-GCM ciphertext + IV |
| principal secret | hash + prefix only |
| audit log | metadata only, no secret values |

## What the server does not do

The current worker will not:

* decrypt zero-knowledge items for remote callers
* mount items for remote callers
* bypass explicit grant checks
* return raw principal secret hashes
* preserve a second application transport beside tRPC

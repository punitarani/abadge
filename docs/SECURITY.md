# Security Model

## Core rules

The current control plane enforces these invariants:

* no plaintext credential storage
* no plaintext agent API-key storage
* no decrypt-before-auth
* no cross-user item access
* every allowed and denied access attempt is audited
* remote agents cannot read ciphertext or use mount delivery
* zero-knowledge plaintext stays in browser or daemon memory

## Encryption modes

### Zero-knowledge items

The browser or daemon performs the cryptographic work.

* root key is wrapped by the user password
* item payload is encrypted client-side
* server stores wrapped item keys and ciphertext
* server never receives plaintext item data

The API can return ciphertext for authorized local agents, but it does not decrypt that data.

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

### Agent callers

Agent procedures require Bearer tokens with the stored agent prefix and hash model:

* `abl_` for local agents
* `abg_` for remote agents

Verification order:

1. candidate lookup by `secretPrefix`
2. constant-time hash verification
3. legacy Better Auth API-key fallback

Successful agent authentication updates `lastUsedAt`.

## Authorization flow

Agent access procedures all follow the same order:

1. authenticate the agent
2. load the target item for the agent's owning user
3. verify permission existence for the exact capability
4. reject expired permissions
5. enforce locality and storage-mode constraints
6. audit the attempt
7. decrypt only if the capability and storage mode permit it

Denied requests are audited before returning an error.

## Capability enforcement

| Agent locality | Zero-knowledge item | Server-managed item |
|-------------------|---------------------|---------------------|
| local | `read_ciphertext`, `mount_env`, `mount_file` | `reveal_plaintext`, `mount_env`, `mount_file` |
| remote | denied | `reveal_plaintext` only |

Current permission creation also blocks:

* remote agent permissions on zero-knowledge items
* remote permissions for capabilities other than `reveal_plaintext`

## Audit logging

The audit log is append-only.

Each entry may include:

* `userId`
* `agentId`
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
| agent secret | hash + prefix only |
| audit log | metadata only, no secret values |

## CLI local storage

The local CLI stores operator auth state in `~/.abadge/config.json` with `0600` file permissions.

Stored fields:

* `sessionCookie` for session-authenticated control-plane commands
* `principalSecret` for local agent-authenticated access commands

Both values are stored in plaintext on disk by design for the current local CLI flow. A stolen config
file gives the attacker whatever session and local-agent access those credentials still allow.

## What the server does not do

The current worker will not:

* decrypt zero-knowledge items for remote callers
* mount items for remote callers
* bypass explicit permission checks
* return raw agent secret hashes
* preserve a second application transport beside tRPC

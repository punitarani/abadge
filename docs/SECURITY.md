# Security Model

## Core rules

The control plane enforces these invariants:

* no plaintext credential storage
* no plaintext legacy API-key storage
* no plaintext human session-token storage on disk
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

### Server-managed items

The API worker encrypts and decrypts payloads with AES-256-GCM.

* key source: Worker secret `ENCRYPTION_KEY`
* IV: random 12-byte nonce
* decrypt only happens after authorization checks pass

## Authentication

### Human operator session

The dashboard uses Better Auth cookies.

The CLI uses Better Auth device authorization:

1. request a device code
2. approve in the browser
3. receive a bearer access token
4. keep that token in daemon memory only

The CLI config file no longer stores a human bearer token.

### Local runtime agent

Local CLI and MCP runtimes use keypair-backed agents:

* Ed25519 keypair generated locally
* private key stored locally with `0600` permissions
* public key stored on the server
* runtime signs a short-lived challenge
* server issues an opaque `abs_...` session token hashed at rest

### Remote runtime agent

Remote agents default to the same public-key session model through bootstrap-token enrollment.

Legacy API keys remain available only as a migration path:

* `abl_...` local
* `abg_...` remote

## Agent auth resolution

Agent procedures resolve Bearer credentials in this order:

1. `abs_...` session token
2. stored legacy API-key prefix/hash match
3. legacy Better Auth API-key fallback

Successful agent auth updates `lastUsedAt`.

## Authorization flow

Agent access procedures follow this order:

1. authenticate the agent
2. load the target item for the agent owner
3. verify explicit permission existence for the exact capability
4. reject expired permissions
5. enforce locality and storage-mode constraints
6. audit the attempt
7. decrypt only if the capability and storage mode permit it

Denied requests are audited before returning an error.

## Capability enforcement

| Agent locality | Zero-knowledge item | Server-managed item |
|------|------|------|
| local | `read_ciphertext`, `mount_env`, `mount_file` | `reveal_plaintext`, `mount_env`, `mount_file` |
| remote | denied | `reveal_plaintext` only |

## Audit logging

The audit log is append-only.

New auth and session lifecycle events include:

* `auth.login`
* `auth.logout`
* `agent.bootstrap_issue`
* `agent.enroll`
* `agent.session_issue`
* `agent.session_reject`
* `agent.session_revoke`

Access events remain logged for both allowed and denied outcomes.

## Storage summary

| Data | Stored form |
|------|-------------|
| vault root key | wrapped key only |
| zero-knowledge item value | ciphertext only |
| server-managed item value | AES-256-GCM ciphertext + IV |
| legacy agent secret | hash + prefix only |
| bootstrap token | hash only |
| `abs_...` session token | hash only |
| connector config | ciphertext |
| audit log | metadata only, no secret values |

# Security Model

## Core principle

Abadge is an access control plane around credentials. Agents should be able to use credentials
without defaulting to plaintext exposure or broad standing vault access.

Storage exists to support policy evaluation, approvals, delivery-mode enforcement, and audit.

## Encryption

### Credential values

* **Algorithm**: AES-256-GCM (via Web Crypto API)
* **IV**: 12 random bytes per credential, stored alongside ciphertext (base64-encoded)
* **Key**: Base64-encoded 32-byte key, stored in Cloudflare Worker Secrets (never in DB or code)
* **Scope**: credential values and connector configs

Generate a key: `openssl rand -base64 32`

### Connector configs

Same AES-256-GCM encryption as credential values. Connector tokens, addresses, and auth material
are encrypted at rest. Decrypted only in the API worker when fetching external secrets.

## Credential lifecycle

1. User submits plaintext value via dashboard or CLI
2. API encrypts with AES-256-GCM using a random 12-byte IV
3. Ciphertext + IV stored in Postgres (base64-encoded)
4. Plaintext exists only in API worker memory during encrypt/decrypt
5. Decryption happens only for value-returning delivery modes AND after all authorization checks pass

For external credentials (`sourceType: "external"`), no secret value is stored. The connector
fetches the value from the external vault at access time, after authorization.

## Agent authentication

### API keys

* Generated at agent registration via Better Auth API key system
* SHA-256 hashed before storage
* Only the hash + visible prefix stored in DB
* Full key shown once to user, never retrievable again
* Prefix: `abg_`

### Broker session tokens

* Generated at session creation (32 random bytes, base64url-encoded)
* SHA-256 hashed before storage
* TTL enforced (max 24 hours)
* Scoped to specific credentials and delivery modes
* Revocable by agent
* Prefix: `abs_`

## Authorization checks (per access request)

All checks are evaluated before any decryption occurs:

1. **Agent identity**: valid API key or non-expired, non-revoked session token
2. **Agent status**: agent must be enabled
3. **Credential ownership**: credential must belong to the agent's registering user
4. **Permission grant**: explicit grant must exist for this agent-credential pair, OR a matching auto-grant must exist
5. **Permission expiry**: grant must not be expired
6. **Policy evaluation**: all attached policy rules must pass
7. **Approval check**: if any policy rule requires approval, a valid, non-expired approval must exist
8. **Delivery mode**: requested mode must be permitted by the intersection of credential's allowed modes, grant's allowed modes, and policy's effective modes

## Delivery mode enforcement

| Mode | Value returned to caller? | Typical use |
|------|--------------------------|-------------|
| `reveal` | Yes (plaintext in response) | Direct API consumers, explicit opt-in |
| `env_inject` | Yes (broker injects into subprocess env) | CI/CD, development |
| `file_mount` | Yes (broker writes temp file with 0600 perms) | TLS certs, service accounts |
| `browser_fill` | No (broker fills form via metadata) | Browser automation |
| `operation_only` | No (server-side use only) | API calls on behalf of agent |

Default delivery mode for agent access is `env_inject`. Credentials can restrict which modes are allowed at the credential level, the permission level, and the policy level. The effective set is the intersection of all three.

## Audit trail

Every access attempt is logged immutably with:

* Agent identity (id, name) and principal type (human, app, agent, workload)
* Credential identity (id, name)
* Requested action and delivery mode
* Actual outcome (allowed, denied, pending\_approval, expired)
* Destination, environment, purpose
* Session ID (if session-based auth)
* Approval ID (if applicable)
* Connector used (if applicable)
* IP address and timestamp

Audit records have no foreign key constraints -- they persist after credential or agent deletion. The access\_log table is append-only.

## Policy system

Policies are sets of rules attached to credentials or permission grants:

* **delivery\_mode**: restrict allowed modes (list of permitted delivery modes)
* **environment**: restrict to specific environments (list of allowed environments)
* **sensitivity**: require approval above a threshold (sensitivity level + requiresApproval flag)
* **destination**: allow/block specific destinations (allow list and block list)
* **ttl**: limit session duration (max TTL in seconds)

Policy evaluation is a pure function. It takes resolved policy data and request context, returns allow/deny/approval-required plus the effective delivery mode set.

## HTTP connector isolation

HTTP connectors (Doppler, HashiCorp Vault, Infisical) run server-side in the API worker:

* Connector configs (tokens, addresses, namespaces) are encrypted at rest with AES-256-GCM
* Outbound requests to external vaults happen only in the API worker -- connector credentials never leave the server
* Fetched secret values pass through the same authorization, policy evaluation, and audit pipeline as native credentials
* A credential with `sourceType: "external"` stores a reference (`externalRef`) that the connector resolves at access time
* Connector test endpoints verify connectivity without fetching secrets

## Org access control

Credentials can be scoped to an organization via `orgId`:

* Org-scoped credentials (`ownerScope: "org"`) are accessible to members of the organization
* Org admin or owner role is required for credential management operations on org-scoped credentials
* Org membership is resolved via Better Auth's organization system
* Cross-org credential access is not permitted

## Rate limiting

| Path pattern | Limit |
|-------------|-------|
| `/api/auth/*` | 60 requests per 60 seconds |
| `/v1/*` | 100 requests per 60 seconds |

## Transport security

* Secure headers applied via Hono middleware on all responses
* CORS configured with explicit trusted origins (API\_URL and APP\_URL)
* Credentials (cookies) allowed in cross-origin requests

## What the server stores

| Data | Storage form |
|------|-------------|
| Credential values | AES-256-GCM ciphertext + IV |
| API keys | SHA-256 hash + visible prefix |
| Session tokens | SHA-256 hash + visible prefix |
| Connector configs | AES-256-GCM ciphertext + IV |
| User passwords | Managed by Better Auth (bcrypt) |
| Access logs | Plaintext (immutable, no secrets) |

## What the server never stores

* Plaintext credential values
* Plaintext API keys
* Plaintext session tokens
* The encryption key (lives in Worker Secrets only)

## What is NOT in scope for v1

* End-to-end / zero-knowledge encryption
* Hardware security modules (HSM/KMS integration)
* Key rotation automation
* Multi-party approval
* Dynamic database credentials
* Confidential computing / TEE

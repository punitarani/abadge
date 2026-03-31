# Security Model

## Core principle

Abadge is an access control plane around credentials. Agents should be able to use credentials
without defaulting to plaintext exposure or broad standing vault access.

Storage exists to support policy evaluation, approvals, delivery-mode enforcement, and audit. It is
not a claim that v1 is a zero-knowledge vault product.

## Encryption

* **Algorithm**: AES-256-GCM
* **IV**: 12 random bytes per credential, stored alongside ciphertext
* **Key**: Base64-encoded 32-byte key, stored in Cloudflare Worker Secrets (never in DB or code)
* **Scope**: credential values, connector configs (including HTTP connector tokens and auth material)

Generate a key: `openssl rand -base64 32`

## Credential lifecycle

1. User submits plaintext value via dashboard or CLI
2. API encrypts with AES-256-GCM using random IV
3. Ciphertext + IV stored in Postgres
4. Plaintext exists only in API worker memory during encrypt/decrypt
5. Decryption happens only when delivery mode is "reveal" AND all authorization checks pass

## Agent authentication

### API keys

* Generated at agent registration (random bytes)
* SHA-256 hashed before storage
* Only the hash + visible prefix stored in DB
* Full key shown once to user, never retrievable again
* Prefix: `abd_`

### Broker session tokens

* Generated at session creation (random bytes)
* SHA-256 hashed before storage
* TTL enforced (max 24 hours)
* Scoped to specific credentials and delivery modes
* Revocable by agent or user
* Prefix: `abs_`

## Authorization checks (per access request)

1. **Agent identity**: valid API key or non-expired, non-revoked session token
2. **Agent status**: agent must be enabled
3. **Credential ownership**: credential must belong to the agent's registering user
4. **Permission grant**: explicit grant must exist for this agent-credential pair
5. **Permission expiry**: grant must not be expired
6. **Policy evaluation**: all attached policy rules must pass
7. **Delivery mode**: requested mode must be in the intersection of credential's allowed modes, grant's allowed modes, and policy's allowed modes
8. **Approval**: if any policy rule requires approval, a valid approval must exist

All checks are evaluated before any decryption occurs.

## Delivery mode enforcement

| Mode | Value returned to caller? | Typical use |
|------|--------------------------|-------------|
| `reveal` | Yes (plaintext in response) | Direct API consumers, explicit opt-in |
| `env_inject` | Yes (broker injects into subprocess env) | CI/CD, development |
| `file_mount` | Yes (broker writes temp file with 0600 perms) | TLS certs, service accounts |
| `browser_fill` | No (broker fills form via metadata) | Browser automation |
| `operation_only` | No (server-side use only) | API calls on behalf of agent |

Default is **not reveal**. Credentials can restrict which modes are allowed.

## Audit trail

Every access attempt is logged immutably with:

* Agent identity and principal type
* Credential identity
* Requested delivery mode
* Actual outcome (allowed, denied, pending_approval, expired)
* Destination, environment, purpose
* Session ID (if session-based auth)
* IP address and timestamp
* Approval context (if applicable)

Audit records have no foreign key constraints — they persist after credential or agent deletion.

## Policy system

Policies are sets of rules attached to credentials or permission grants:

* **delivery_mode**: restrict allowed modes
* **environment**: restrict to specific environments
* **sensitivity**: require approval above a threshold
* **destination**: allow/block specific destinations
* **ttl**: limit session duration

Policy evaluation is a pure function with no side effects. It takes resolved policy data and request context, returns allow/deny/approval-required.

## HTTP connector isolation

HTTP connectors (Doppler, HashiCorp Vault, Infisical) run server-side in the API worker. Their security model:

* Connector configs (tokens, addresses, namespaces) are encrypted at rest with AES-256-GCM, same as credential values
* Outbound requests to external vaults happen only in the API worker -- connector credentials never leave the server
* Fetched secret values pass through the same authorization, policy evaluation, and audit pipeline as native credentials
* A credential with `sourceType: "external"` does not store a secret value -- it stores a reference (`externalRef`) that the connector resolves at access time
* Connector test endpoints (`POST /v1/connectors/:id/test`) verify connectivity without fetching secrets

## Org access control

Credentials can be scoped to an organization via `orgId`:

* Org-scoped credentials (`ownerScope: "org"`) are accessible to members of the organization
* Org admin or owner role is required for credential management operations on org-scoped credentials
* Org membership is resolved via Better Auth's organization system
* Cross-org credential access is not permitted

## What is NOT in scope for v1

* End-to-end encryption (user -> server -> user)
* Hardware security modules (HSM/KMS integration)
* Key rotation automation
* Multi-party approval
* Dynamic database credentials
* Confidential computing / TEE

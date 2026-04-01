# Architecture

## Overview

abadge is a credential control plane for AI agents. Users store native encrypted credentials or
reference external secret systems, define access policies, register agents, grant scoped
permissions, and audit every access attempt. The system defaults to non-reveal delivery --
plaintext is the exception, not the product.

## System parts

* **API** -- Hono on Cloudflare Workers. Canonical control plane for auth, CRUD, policy
  evaluation, approval workflows, encryption, session issuance, and audit logging.
* **Web** -- Next.js App Router dashboard via OpenNext. Operator surface for credentials, agents,
  policies, approvals, connectors, and audit.
* **CLI** -- `abadge` command. Developer/admin interface for runtime secret use and management.
* **SDK** -- TypeScript client (`@abadge/sdk`). Typed API client for applications and agent runtimes.
* **MCP server** -- Model Context Protocol server for AI agents. Secrets never returned to the LLM
  by default.
* **Broker** -- Local execution engine shared by CLI and MCP. Handles subprocess injection, temp
  file mounts, session management, and broker-side external vault connectors.
* **Database** -- Single Postgres instance (PlanetScale via Hyperdrive). Source of truth for all
  control-plane state.

## Package structure

```text
apps/
  api/        Hono API worker (control plane)
  cli/        Distributable CLI binary (bun build --compile)
  web/        Next.js dashboard
packages/
  auth/       Better Auth setup (server + client)
  broker/     local execution engine (env inject, file mount, sessions, connectors)
  cli/        CLI tool library (commands, config, output)
  config/     shared tsconfig
  core/       shared types, zod schemas, constants, error shapes
  db/         Drizzle schema + database client
  env/        environment variable validation (server, client, worker)
  mcp/        MCP server for AI agents
  sdk/        TypeScript SDK (@abadge/sdk)
```

Build order: `config -> core -> env -> db -> auth -> api/web` (Turborepo handles this).

## Deployment model

```mermaid
flowchart LR
  U[User Browser] --> W[Next.js on Cloudflare Workers]
  A[Agent / CLI / MCP] --> API[Hono API on Cloudflare Workers]
  W --> API
  API --> H[Cloudflare Hyperdrive]
  H --> DB[(PlanetScale Postgres)]
  CLI[CLI / MCP] --> Broker[Local Broker]
  Broker --> API
  Broker --> ExtVault[External Vaults]
```

## Core concepts

### Credential

A user-owned encrypted secret entry with structured metadata.

* **Identity**: uuid id, user\_id, name (unique per user)
* **Classification**: type (api\_key, login, token, json\_blob, oauth\_client, service\_account\_json, cookie\_session, pii, other)
* **Security**: sensitivity (low/medium/high/critical), allowed delivery modes, allowed destinations
* **Context**: environment (dev/staging/prod), service, provider, project, tags
* **Secret material**: AES-256-GCM encrypted value + IV (never stored plaintext)
* **Ownership**: ownerScope (user/org/system), orgId
* **External source**: sourceType (native/external), connectorId, externalRef (name, path, version)

Credentials with `sourceType: "external"` store a reference to a secret in an external vault rather than an encrypted value. The value is fetched from the connector at access time.

### Agent

A user-registered consumer of secrets, implemented as a Better Auth API key with prefix `abg_`. The key is SHA-256 hashed before storage. Only the hash and a visible prefix are persisted.

### Permission

An explicit grant joining one agent to one credential. Can attach a policy and constrain delivery modes with an expiration. Stored in `agent_credential_permissions` with a composite primary key.

### Auto-grant

A rule that automatically grants an agent permission to access any credential matching specified criteria. Matching is conjunctive (all non-null criteria must match). Evaluated at access time as a fallback when no explicit permission exists.

### Policy

A set of rules attached to a credential or grant that governs access:

* **delivery\_mode** -- restrict which delivery modes are allowed
* **environment** -- restrict to specific environments
* **sensitivity** -- require approval above a threshold
* **destination** -- allow/block specific destinations
* **ttl** -- limit session duration

Policy evaluation is a pure function with no side effects.

### Approval

A pending access request created when a policy requires human approval. Approvals have a 24-hour TTL. Only the credential owner can approve or deny.

### Broker session

A short-lived, scoped token (prefix `abs_`) that replaces static API keys for runtime access. Sessions have a TTL (max 24h), optional credential scopes, and delivery mode constraints. Revocable.

### Connector

A configuration for fetching secrets from external vaults. Two categories:

* **Client-side connectors** (via broker): native, 1Password, AWS Secrets Manager, Bitwarden, GCloud Secret Manager
* **HTTP connectors** (server-side): Doppler, HashiCorp Vault, Infisical

Connector configs are encrypted at rest with AES-256-GCM.

### Agent group

A named collection of agents owned by a user. Groups organize agents for management. Membership cascades on group deletion.

### Delivery modes

| Mode | Behavior | Value returned? |
|------|----------|-----------------|
| `reveal` | Return decrypted plaintext in API response | Yes |
| `env_inject` | API returns value; broker injects as env var in subprocess | Yes |
| `file_mount` | API returns value; broker writes to temp file (mode 0600) | Yes |
| `browser_fill` | Metadata only; broker fills browser form fields | No |
| `operation_only` | Metadata only; credential used server-side only | No |

Default is NOT reveal. Plaintext exposure requires explicit opt-in.

### Access log

Immutable event for every access attempt (allowed, denied, pending\_approval, expired). No foreign key constraints -- records persist after entity deletion. Includes agent identity, credential identity, delivery mode, outcome, destination, environment, purpose, session ID, IP address, and timestamp.

## Entity model

```mermaid
erDiagram
  USER ||--o{ CREDENTIAL : owns
  USER ||--o{ AGENT : registers
  USER ||--o{ POLICY : defines
  USER ||--o{ CONNECTOR : configures
  USER ||--o{ AUTO_GRANT : defines
  USER ||--o{ AGENT_GROUP : owns
  AGENT ||--o{ PERMISSION : has
  AGENT ||--o{ AUTO_GRANT : receives
  AGENT ||--o{ AGENT_GROUP_MEMBER : belongs_to
  AGENT_GROUP ||--o{ AGENT_GROUP_MEMBER : contains
  CREDENTIAL ||--o{ PERMISSION : grants
  CREDENTIAL }o--o| CONNECTOR : sourced_from
  POLICY ||--o{ PERMISSION : constrains
  CREDENTIAL ||--o{ POLICY : scoped_to
  AGENT ||--o{ BROKER_SESSION : creates
  AGENT ||--o{ ACCESS_LOG : generates
  CREDENTIAL ||--o{ ACCESS_LOG : targets
  CREDENTIAL ||--o{ APPROVAL : requires

  CREDENTIAL {
    uuid id PK
    string user_id FK
    string name
    string type
    string encrypted_value
    string iv
    string sensitivity
    string environment
    string source_type
    string connector_id FK
    jsonb external_ref
    string org_id
    jsonb allowed_delivery_modes
    jsonb tags
  }

  AGENT {
    string id PK
    string name
    string key_hash
    string prefix
    boolean enabled
    string reference_id FK
  }

  PERMISSION {
    string agent_id PK_FK
    uuid credential_id PK_FK
    string policy_id FK
    jsonb allowed_delivery_modes
    timestamp expires_at
  }

  POLICY {
    string id PK
    string user_id FK
    string name
    uuid credential_id FK
    jsonb rules
    boolean enabled
  }

  AUTO_GRANT {
    string id PK
    string agent_id FK
    string user_id FK
    string match_environment
    jsonb match_tags
    string match_type
    string match_service
    string match_sensitivity
  }

  AGENT_GROUP {
    string id PK
    string user_id FK
    string name
    string description
  }

  APPROVAL {
    string id PK
    string requester_id FK
    string approver_id
    string credential_id FK
    string agent_id FK
    string status
    string delivery_mode
    timestamp expires_at
  }

  BROKER_SESSION {
    string id PK
    string token_hash
    string agent_id FK
    string user_id FK
    jsonb scopes
    timestamp expires_at
  }

  ACCESS_LOG {
    serial id PK
    string agent_id
    uuid credential_id
    string outcome
    string delivery_mode
    string principal_type
    string environment
    string session_id
  }
```

## Trust boundaries

```mermaid
flowchart TB
  subgraph Public
    U[User Browser]
    A[Agent / CLI / MCP]
  end

  subgraph Edge Runtime
    W[Web App]
    API[API]
  end

  subgraph Local Runtime
    Broker[Broker]
    ExtVault[External Vaults]
  end

  subgraph Data Layer
    DB[(Postgres)]
  end

  U --> W
  A --> Broker
  Broker --> API
  W --> API
  API --> DB

  K[(Worker Secret: Encryption Key)] -. available only to API .-> API
```

### Boundary rules

* The database never stores plaintext credentials or API keys
* The encryption key lives only in Worker Secrets, never in the database
* The web app does not decide authorization for agent reads
* The API is the only place where credential decryption happens
* Decryption occurs only for value-returning delivery modes AND after authorization passes
* Agents can only access credentials owned by the same user who registered them
* The LLM never receives raw secrets through the MCP server by default
* HTTP connectors make outbound requests from the API worker -- connector credentials are encrypted at rest and never leave the server

## Main request paths

### Policy-aware agent access (primary path)

```mermaid
sequenceDiagram
  actor Agent
  participant API
  participant DB
  participant Crypto

  Agent->>API: Bearer token + credential + deliveryMode + purpose
  API->>DB: Resolve agent (hash lookup)
  API->>DB: Resolve credential (scoped to agent's user)
  API->>DB: Check explicit permission or auto-grant (+ expiry)
  API->>DB: Load attached policy (if any)

  alt policy requires approval
    API->>DB: Create approval record
    API->>DB: Log pending_approval
    API-->>Agent: 202 + approvalId
  else delivery mode denied
    API->>DB: Log denied
    API-->>Agent: 403
  else value-returning mode (reveal/env_inject/file_mount)
    API->>Crypto: Decrypt (or fetch from connector)
    Crypto-->>API: Plaintext
    API->>DB: Log allowed
    API-->>Agent: Credential value
  else non-value mode (browser_fill/operation_only)
    API->>DB: Log allowed
    API-->>Agent: Credential metadata (no value)
  end
```

### Local broker injection (CLI / MCP)

```mermaid
sequenceDiagram
  actor Dev
  participant CLI
  participant Broker
  participant API
  participant Subprocess

  Dev->>CLI: abadge run --secret X -- cmd
  CLI->>Broker: accessSecret(name, deliveryMode=reveal)
  Broker->>API: POST /v1/credentials/access
  API-->>Broker: Decrypted value
  Broker->>Subprocess: spawn(cmd, env={SECRET=value})
  Subprocess-->>CLI: exit code
  CLI-->>Dev: Forward exit code
```

## Authentication

### Dashboard user auth

* Better Auth with email/password and optional social login (Google, GitHub)
* Session-based
* Used for all `/v1/*` management routes

### Agent auth (two methods)

1. **API key** (static) -- `abg_` prefix, SHA-256 hashed, shown once at creation
2. **Broker session** (short-lived) -- `abs_` prefix, SHA-256 hashed, TTL up to 24h, scoped

Agent auth middleware tries session token first (by prefix), then falls back to API key.

### Authorization model

* No wildcard grants
* No cross-user access
* Explicit permission per agent-credential pair (or matching auto-grant)
* Policy evaluation on every access
* Delivery mode enforcement on every access
* Permission expiration checked on every access

## Security invariant

A secret value is only returned when ALL conditions are true:

1. The agent presented a valid, active API key or non-expired session token
2. The credential exists and belongs to the agent's owner
3. An explicit permission grant or matching auto-grant exists and has not expired
4. All attached policies allow the requested action
5. No policy requires approval (or approval was granted and not expired)
6. The requested delivery mode is value-returning (reveal, env\_inject, or file\_mount)
7. The delivery mode is permitted by credential, permission, and policy constraints

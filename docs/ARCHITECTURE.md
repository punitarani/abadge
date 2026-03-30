# Architecture

## Overview

abadge is an agent credential firewall and runtime access layer. Users store encrypted secrets, define access policies, register agents, grant scoped permissions, and audit every access attempt. The system defaults to non-reveal delivery — plaintext is the exception, not the product.

### System parts

* **API** — Hono on Cloudflare Workers. Owns auth, CRUD, policy evaluation, approval workflows, encryption, and audit logging.
* **Web** — Next.js App Router dashboard. Operator surface for credentials, agents, policies, approvals, and audit.
* **CLI** — `abadge` command. Developer interface for secret injection, file mounting, and management.
* **MCP server** — Model Context Protocol server for AI agents. Secrets never returned to the LLM by default.
* **Broker** — Local execution engine shared by CLI and MCP. Handles subprocess injection, temp file mounts, session management, and external vault connectors.
* **Database** — Single Postgres instance (PlanetScale via Hyperdrive). Source of truth for all state.

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

## Design goals

* minimal system surface area
* explicit user control over agent access
* delivery modes that avoid plaintext exposure by default
* policy-driven access with approval workflows
* single durable state store
* edge-friendly request latency
* complete audit trail on every access attempt
* no background infrastructure

## Core concepts

### Credential

A user-owned encrypted secret entry with structured metadata.

* **Identity**: id, user, name
* **Classification**: type (api_key, login, token, json_blob, oauth_client, service_account_json, cookie_session, pii, other)
* **Security**: sensitivity (low/medium/high/critical), allowed delivery modes, allowed destinations
* **Context**: environment (dev/staging/prod), service, provider, project, tags
* **Secret material**: AES-256-GCM encrypted value + IV (never stored plaintext)
* **Ownership**: ownerScope (user/org/system)

### Agent

A user-registered consumer of secrets, identified by a hashed API key with visible prefix.

### Permission

A grant joining one agent to one credential. Can optionally attach a policy and constrain delivery modes with an expiration.

### Policy

A set of rules attached to a credential or grant that governs access. Rule types:

* **delivery_mode** — restrict which delivery modes are allowed
* **environment** — restrict to specific environments
* **sensitivity** — require approval above a sensitivity threshold
* **destination** — allow/block specific destinations
* **ttl** — limit session duration

### Approval

A pending access request created when a policy requires human approval. Approvals have a 24-hour TTL and can be approved or denied by the credential owner.

### Broker session

A short-lived, scoped token that replaces static API keys for runtime access. Sessions have a TTL (max 24h), optional credential scopes, and delivery mode constraints.

### Connector

A configuration for fetching secrets from external vaults (1Password, AWS Secrets Manager) through the same policy and audit model.

### Delivery modes

| Mode | Behavior |
|------|----------|
| `reveal` | Return decrypted plaintext in API response |
| `env_inject` | CLI injects secret as environment variable in subprocess |
| `file_mount_tmpfs` | CLI writes secret to temp file (mode 0600), auto-cleaned |
| `browser_fill` | Future: browser extension fills form fields |
| `operation_only` | Future: credential used server-side without returning to client |

Default is NOT reveal. Plaintext exposure requires explicit opt-in.

### Access log

Immutable event for every access attempt (allowed, denied, pending_approval, expired). No foreign key constraints — records persist after entity deletion.

## Entity model

```mermaid
erDiagram
  USER ||--o{ CREDENTIAL : owns
  USER ||--o{ AGENT : registers
  USER ||--o{ POLICY : defines
  USER ||--o{ CONNECTOR : configures
  AGENT ||--o{ PERMISSION : has
  CREDENTIAL ||--o{ PERMISSION : grants
  POLICY ||--o{ PERMISSION : constrains
  CREDENTIAL ||--o{ POLICY : scoped_to
  AGENT ||--o{ BROKER_SESSION : creates
  AGENT ||--o{ ACCESS_LOG : generates
  CREDENTIAL ||--o{ ACCESS_LOG : targets
  CREDENTIAL ||--o{ APPROVAL : requires

  CREDENTIAL {
    uuid id
    string user_id
    string name
    string type
    string encrypted_value
    string iv
    string sensitivity
    string environment
    jsonb allowed_delivery_modes
    jsonb tags
  }

  AGENT {
    string id
    string name
    string key_hash
    string prefix
    boolean enabled
  }

  PERMISSION {
    string agent_id
    uuid credential_id
    string policy_id
    jsonb allowed_delivery_modes
    timestamp expires_at
  }

  POLICY {
    string id
    string name
    uuid credential_id
    jsonb rules
    boolean enabled
  }

  APPROVAL {
    string id
    string status
    string delivery_mode
    timestamp expires_at
  }

  BROKER_SESSION {
    string id
    string token_hash
    jsonb scopes
    timestamp expires_at
  }

  ACCESS_LOG {
    int id
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

* the database never stores plaintext credentials or API keys
* the encryption key lives only in Worker Secrets, never in the database
* the web app does not decide authorization for agent reads
* the API is the only place where credential decryption happens
* decryption only occurs when deliveryMode is "reveal" AND authorization passes
* agents can only access credentials owned by the same user who registered them
* the LLM never receives raw secrets through the MCP server by default

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
  API->>DB: Check permission (+ expiry)
  API->>DB: Load attached policies

  alt policy requires approval
    API->>DB: Create approval record
    API->>DB: Log pending_approval
    API-->>Agent: 202 + approvalId
  else delivery mode denied
    API->>DB: Log denied
    API-->>Agent: 403
  else reveal mode
    API->>Crypto: Decrypt
    Crypto-->>API: Plaintext
    API->>DB: Log allowed
    API-->>Agent: Credential value
  else non-reveal mode
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

* Better Auth with email/password
* Session-based (7-day expiry)
* Used for all `/v1/*` management routes

### Agent auth (two methods)

1. **API key** (static) — `abd_` prefix, SHA-256 hashed, shown once at creation
2. **Broker session** (short-lived) — `abs_` prefix, SHA-256 hashed, TTL up to 24h, scoped

Agent auth middleware tries session token first (by prefix), then falls back to API key.

### Authorization model

* no wildcard grants
* no cross-user access
* explicit permission per agent-credential pair
* policy evaluation on every access
* delivery mode enforcement on every access
* permission expiration checked on every access

## Security model

### Controls

* AES-256-GCM encryption at rest
* Worker-secret encryption key (never in DB or code)
* SHA-256 hashed API keys and session tokens
* Per-credential ACLs with policy attachment
* Delivery mode enforcement (default non-reveal)
* Approval workflows for sensitive access
* Immutable audit log (no FK constraints)
* Secure headers and rate limiting
* Parameterized database access via Drizzle ORM

### Security invariant

A secret value is only returned when ALL conditions are true:

1. The agent presented a valid, active API key or non-expired session token
2. The credential exists and belongs to the agent's owner
3. An explicit permission grant exists and has not expired
4. All attached policies allow the requested delivery mode
5. No policy requires approval (or approval was granted)
6. The requested delivery mode is "reveal"

## Monorepo structure

```text
apps/
  api/        Hono API worker (control plane)
  web/        Next.js dashboard
packages/
  auth/       Better Auth setup
  broker/     local execution engine
  cli/        CLI tool
  config/     shared tsconfig
  core/       shared types, schemas, constants
  db/         schema and database client
  env/        environment validation
  mcp/        MCP server for AI agents
```

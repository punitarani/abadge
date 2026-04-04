# API Reference

The canonical control-plane transport is tRPC over HTTP at `/trpc`.

Better Auth remains mounted at `/api/auth/*`.

Base URL:

* production: `https://your-api-domain`
* local development: `http://localhost:8787`

## Transport

Use the shared clients instead of hand-rolling HTTP requests:

```ts
import { createNodeTrpcClient } from "@abadge/trpc/client";

const client = createNodeTrpcClient({
  baseUrl: "http://localhost:8787",
  token: process.env.ABADGE_SESSION_OR_AGENT_TOKEN,
});
```

## Authentication

### Human operator auth

Better Auth handles user authentication at `/api/auth/*`.

Common routes:

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
POST /api/auth/sign-out
GET  /api/auth/get-session
```

Device authorization routes used by the CLI:

```text
POST /api/auth/device/code
POST /api/auth/device/token
GET  /api/auth/device?user_code=...
POST /api/auth/device/approve
POST /api/auth/device/deny
```

`/api/auth/device/approve` and `/api/auth/device/deny` require an authenticated Better Auth web
session.

Session-backed tRPC procedures accept:

* Better Auth browser cookies
* Better Auth bearer access tokens in `Authorization: Bearer ...`

The CLI stores the bearer token only in daemon memory.

### Agent auth

Agent-facing procedures resolve Bearer credentials in this order:

1. `abs_...` short-lived agent session token lookup in `agent_sessions`
2. legacy `abl_...` / `abg_...` API-key verification by stored prefix and hash
3. legacy Better Auth API-key fallback for migrated records

`abs_...` tokens are opaque, hashed at rest, and expire after 15 minutes.

### Agent enrollment and session lifecycle

Keypair-backed agents use the auth router lifecycle:

| Procedure | Auth | Description |
|------|------|-------------|
| `auth.issueBootstrapToken` | `sessionProcedure` | Issue a one-time `abe_...` bootstrap token |
| `auth.enroll` | `publicProcedure` | Redeem bootstrap token and upload an agent public key |
| `auth.createChallenge` | `publicProcedure` | Create a short-lived signing challenge |
| `auth.exchangeSession` | `publicProcedure` | Verify Ed25519 signature and mint an `abs_...` session |
| `auth.revokeSession` | `publicProcedure` | Revoke an existing `abs_...` session |
| `auth.recordLogin` | `sessionProcedure` | Audit successful CLI login |
| `auth.logout` | `sessionProcedure` | Audit operator logout |

## Procedure tiers

| Tier | Auth | Used by |
|------|------|---------|
| `publicProcedure` | none | agent enrollment and agent session exchange |
| `sessionProcedure` | Better Auth session or bearer session token | dashboard, CLI management commands, SDK |
| `agentProcedure` | agent bearer credential | local runtime agents, MCP, remote agents |

## Selected session procedures

### `agents.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | enum | yes | `device`, `local_cli`, `local_mcp`, `remote_agent` |
| `name` | string | yes | Display name |
| `authMethod` | enum | no | `public_key_session` or `legacy_api_key` |
| `publicKey` | string | no | JWK-serialized public key for direct enrollment |
| `issueBootstrapToken` | boolean | no | Whether to issue a one-time bootstrap token |
| `metadata` | object | no | Free-form metadata |

Response:

```ts
{
  agent: Agent;
  apiKey: string | null;
  bootstrapToken: string | null;
  bootstrapExpiresAt: string | null;
}
```

Defaults:

* `authMethod` defaults to `public_key_session`
* legacy API keys are opt-in
* keypair-backed agents without `publicKey` receive a bootstrap token by default

### `agents.rotate`

Auth: `sessionProcedure`

Rotates a legacy API key only.

Response:

```ts
{ apiKey: string; keyPrefix: string }
```

### `permissions.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Agent receiving access |
| `itemId` | string | yes | Target item |
| `capability` | enum | yes | `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`, `use_without_reveal` |
| `expiresAt` | string | no | ISO timestamp for permission expiry |

Current creation-time enforcement also rejects:

* remote agent + zero-knowledge item
* remote agent + capability other than `reveal_plaintext`

## Selected agent procedures

### `access.mount`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `mountType` | `"env" \| "file"` | yes | Requested mount style |

Response:

* zero-knowledge item: `{ storageMode: "zero_knowledge", encryptedItemKey, ciphertext, cryptoVersion }`
* server-managed item: `{ storageMode: "server_managed", payload }`

### `access.reveal`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |

Response: `{ payload }`

### `access.ciphertext`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |

Response: `{ encryptedItemKey, ciphertext, cryptoVersion }`

## Audit events

Auth and agent lifecycle now emit these additional audit event types:

* `auth.login`
* `auth.logout`
* `agent.bootstrap_issue`
* `agent.enroll`
* `agent.session_issue`
* `agent.session_reject`
* `agent.session_revoke`

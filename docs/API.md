# API Reference

The canonical control-plane transport is tRPC over HTTP at `/trpc`.

Better Auth remains mounted at `/api/auth/*`.

There is no REST layer. All application endpoints are tRPC procedures.

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
| `auth.revokeSession` | `sessionProcedure` | Revoke an existing `abs_...` session for the current operator |
| `auth.recordLogin` | `sessionProcedure` | Audit successful CLI login |
| `auth.logout` | `sessionProcedure` | Audit operator logout |

## Procedure tiers

| Tier | Auth | Used by |
|------|------|---------|
| `publicProcedure` | none | agent enrollment and agent session exchange |
| `sessionProcedure` | Better Auth session or bearer session token | dashboard, CLI management commands, SDK |
| `agentProcedure` | agent bearer credential | local runtime agents, MCP, remote agents |

## Session procedures

### `vault.bootstrap`

Auth: `sessionProcedure`

Creates the user's vault. Returns `{ id }`. Fails with `VAULT_ALREADY_EXISTS` (409) if the vault
already exists.

### `vault.get`

Auth: `sessionProcedure`

Returns vault metadata including `wrappedRootKey`, `kdfSalt`, `kdfParams`, `keyVersion`.

### `vault.changePassword`

Auth: `sessionProcedure`

Accepts new `wrappedRootKey`, `kdfSalt`, `kdfParams`. Returns `{ ok: true }`.

### `vault.setupRecovery`

Auth: `sessionProcedure`

Accepts `recoveryWrappedRootKey`. Returns `{ ok: true }`.

### `vault.rotateKey`

Auth: `sessionProcedure`

Accepts `wrappedRootKey` and `rekeyedItems` map. Returns `{ ok: true, keyVersion }`.

### `items.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `storageMode` | enum | yes | `zero_knowledge` or `server_managed` |
| `payload` | object | conditional | Required for `server_managed` items |
| `encryptedItemKey` | string | conditional | Required for `zero_knowledge` items |
| `ciphertext` | string | conditional | Required for `zero_knowledge` items |

Returns `{ id }`.

### `items.list`

Auth: `sessionProcedure`

Returns `{ items }` with metadata only (no secret data). Each item summary includes the durable
`label` field used by the dashboard and audit views.

### `items.get`

Auth: `sessionProcedure`

Input: `{ itemId }`. Returns `{ item }`.

### `items.update`

Auth: `sessionProcedure`

Input: `{ itemId, data }` where `data` contains updated fields and `contentVersion` for optimistic
concurrency. Returns `{ ok: true, contentVersion }`.

### `items.delete`

Auth: `sessionProcedure`

Input: `{ itemId }`. Soft-deletes the item. Returns `{ ok: true }`.

### `agents.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | enum | yes | `device`, `local_cli`, `local_mcp`, `remote_agent` |
| `name` | string | yes | Display name |
| `authMethod` | enum | no | `public_key_session` or `legacy_api_key` (default: `legacy_api_key`) |
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

Behavior:

* `authMethod` defaults to `legacy_api_key`
* `legacy_api_key` agents receive a one-time API key
* `public_key_session` agents must provide either `publicKey` or `issueBootstrapToken: true`
* missing both `publicKey` and `issueBootstrapToken` fails with `PUBLIC_KEY_REQUIRED`
* keypair-backed agents without `publicKey` receive a bootstrap token (`abe_`, 10-min TTL)

### `agents.list`

Auth: `sessionProcedure`

Returns `{ agents }`.

### `agents.get`

Auth: `sessionProcedure`

Input: `{ agentId }`. Returns `{ agent }`.

### `agents.self`

Auth: `agentProcedure`

Returns `{ agent }` for the currently authenticated agent.

### `agents.rotate`

Auth: `sessionProcedure`

Input: `{ agentId }`. Rotates a legacy API key only. Returns `{ apiKey, keyPrefix }`.

### `agents.revoke`

Auth: `sessionProcedure`

Input: `{ agentId }`. Returns `{ ok: true }`.

### `permissions.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Agent receiving access |
| `itemId` | string | yes | Target item |
| `capability` | enum | yes | `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`, `use_without_reveal` |
| `expiresAt` | string | no | ISO timestamp for permission expiry |

Creation-time enforcement rejects:

* remote agent + zero-knowledge item (`REMOTE_AGENT_ZK_FORBIDDEN`)
* remote agent + capability other than `reveal_plaintext`

### `permissions.list`

Auth: `sessionProcedure`

Optional filters: `agentId`, `itemId`. Returns `{ permissions }`.

### `permissions.revoke`

Auth: `sessionProcedure`

Input: `{ permissionId }`. Returns `{ ok: true }`.

### `audit.list`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `eventType` | enum | no | Filter by event type |
| `result` | enum | no | Filter by result (`allowed`, `denied`, `expired`, `revoked`) |
| `agentId` | string | no | Filter by agent |
| `itemId` | string | no | Filter by item |
| `cursor` | string | no | Pagination cursor (numeric string) |
| `limit` | integer | no | 1--100, default 50 |

Returns `{ entries, nextCursor }`.

## Agent procedures

### `access.ciphertext`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |

Returns `{ encryptedItemKey, ciphertext, cryptoVersion }`.

Denied if: remote agent, non-ZK item, or missing `read_ciphertext` permission.

### `access.reveal`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |

Returns `{ payload }`.

Denied if: non-server-managed item, or missing `reveal_plaintext` permission.

### `access.mount`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `mountType` | `"env" \| "file"` | yes | Requested mount style |

Response:

* zero-knowledge item: `{ storageMode: "zero_knowledge", encryptedItemKey, ciphertext, cryptoVersion }`
* server-managed item: `{ storageMode: "server_managed", payload }`

Denied if: remote agent, or missing `mount_env`/`mount_file` permission.

## Error codes

| Code | HTTP | Description |
|------|------|-------------|
| `VAULT_ALREADY_EXISTS` | 409 | Vault bootstrap attempted when vault exists |
| `AGENT_NOT_FOUND` | 404 | Agent ID does not exist or belongs to another user |
| `ITEM_NOT_FOUND` | 404 | Item ID does not exist, belongs to another user, or is deleted |
| `PERMISSION_DENIED` | 403 | No matching grant or locality restriction |
| `REMOTE_AGENT_ZK_FORBIDDEN` | 403 | Remote agent tried to access a zero-knowledge item |
| `PUBLIC_KEY_REQUIRED` | 400 | public_key_session agent created without publicKey or issueBootstrapToken |
| `ENROLLMENT_REQUIRED` | 400 | Agent has no public key enrolled |
| `integrity_error` | 500 | Server-side data integrity failure |

## Audit events

Auth and agent lifecycle emit these audit event types:

* `auth.login`
* `auth.logout`
* `agent.create`
* `agent.bootstrap_issue`
* `agent.enroll`
* `agent.rotate`
* `agent.revoke`
* `agent.session_issue`
* `agent.session_reject`
* `agent.session_revoke`
* `access.ciphertext`
* `access.reveal`
* `access.mount_env`
* `access.mount_file`

## Rate limiting

| Path | Limit |
|------|-------|
| `/api/auth/*` | 60 requests/minute per IP |
| `/trpc/*` | 100 requests/minute per IP |

## Health check

`GET /health` returns `{ "status": "ok" }`. No authentication required.

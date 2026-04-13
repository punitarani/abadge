# API Reference

The canonical control-plane transport is tRPC over HTTP at `/trpc`.

Better Auth is mounted at `/api/auth/*`.

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

## Error envelope

All domain errors use a consistent JSON envelope:

```json
{
  "code": "ITEM_NOT_FOUND",
  "message": "Item not found.",
  "hint": "Verify the item ID and that it belongs to your organization.",
  "meta": {}
}
```

Validation errors include an additional `issues` array:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Missing required field.",
  "hint": "Check the invalid input fields and try again.",
  "issues": [
    { "path": ["itemId"], "message": "Required" }
  ]
}
```

See [`docs/ERRORS.md`](./ERRORS.md) for all error codes.

## Session procedures

### `organizations.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Organization display name |
| `slug` | string | no | URL-safe identifier (auto-generated if omitted) |

Returns `{ id, name, slug }`.

### `organizations.list`

Auth: `sessionProcedure`

Returns `{ organizations }` — each entry includes `id`, `name`, `slug`, `role`.

### `organizations.get`

Auth: `sessionProcedure`

Input: `{ orgId }`. Returns the organization record.

### `organizations.update`

Auth: `sessionProcedure`

Input: `{ orgId, name? }`. Returns `{ ok: true }`.

### `organizations.delete`

Auth: `sessionProcedure`

Input: `{ orgId }`. Deletes the organization and cascades to agents and permissions. Returns `{ ok: true }`.

### `organizations.members.list`

Auth: `sessionProcedure`

Input: `{ orgId }`. Returns the member list.

### `organizations.members.invite`

Auth: `sessionProcedure` (admin+)

Input: `{ orgId, role? }`. Generates a one-time invite link token. Returns `{ ok, invitationId, token }`.

The `token` (prefixed `abi_`) is shown once. Only its SHA-256 hash is stored. The frontend constructs the invite URL: `{APP_URL}/invite/accept?token={token}`.

Invitations expire after 7 days.

### `organizations.members.getInviteInfo`

Auth: `sessionProcedure`

Input: `{ token }`. Returns `{ invitationId, organizationName, organizationSlug, role, expiresAt, inviterUserId }`.

Requires authentication to prevent info disclosure of org names to unauthenticated users.

### `organizations.members.acceptInvite`

Auth: `sessionProcedure`

Input: `{ token }`. Adds the authenticated user as a member with the invite's role. Returns `{ ok, organizationId, organizationName, organizationSlug }`.

Atomic: uses `WHERE usedAt IS NULL` to prevent double-accept race conditions. Returns org data so the frontend can switch context.

### `organizations.members.revokeInvite`

Auth: `sessionProcedure` (admin+)

Input: `{ orgId, invitationId }`. Deletes an unused invitation. Returns `{ ok: true }`.

### `organizations.members.remove`

Auth: `sessionProcedure`

Input: `{ orgId, userId }`. Returns `{ ok: true }`. Cascades agent revocation for agents owned by the removed member.

### `organizations.members.updateRole`

Auth: `sessionProcedure`

Input: `{ orgId, userId, role }`. Returns `{ ok: true }`.

### `profiles.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `orgId` | string | yes | Owning organization |
| `name` | string | yes | Profile display name |
| `description` | string | no | Optional description |
| `storageMode` | enum | no | `zero_knowledge` or `server_managed` (default: `server_managed`) |

Returns `{ id }`.

### `profiles.list`

Auth: `sessionProcedure`

Input: `{ orgId }`. Returns profiles for the organization.

### `profiles.get`

Auth: `sessionProcedure`

Input: `{ profileId }`. Returns profile metadata.

### `profiles.bootstrap`

Auth: `sessionProcedure`

Initializes the encryption state for a zero-knowledge profile.

Input: `{ profileId, wrappedRootKey, kdfSalt, kdfParams }`. Returns `{ id }`.

### `profiles.changePassword`

Auth: `sessionProcedure`

Input: `{ profileId, wrappedRootKey, kdfSalt, kdfParams }`. Returns `{ ok: true }`.

### `profiles.setupRecovery`

Auth: `sessionProcedure`

Input: `{ profileId, recoveryWrappedRootKey }`. Returns `{ ok: true }`.

### `profiles.rotateKey`

Auth: `sessionProcedure`

Input: `{ profileId, wrappedRootKey, rekeyedItems }`. Returns `{ ok: true, keyVersion }`.

### `profiles.delete`

Auth: `sessionProcedure`

Input: `{ profileId }`. Fails with `PROFILE_NOT_EMPTY` if the profile contains items. Returns `{ ok: true }`.

### `vault.*`

Auth: `sessionProcedure`

Legacy per-user vault procedures retained for web app compatibility. These will be removed in a future release. Prefer `profiles.*` for new integrations.

Procedures: `vault.bootstrap`, `vault.get`, `vault.changePassword`, `vault.setupRecovery`, `vault.rotateKey`.

### `items.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `storageMode` | enum | yes | `zero_knowledge` or `server_managed` |
| `label` | string | yes | Display name |
| `kind` | enum | no | Item kind (e.g. `opaque`, `api_key`, `login`) |
| `payload` | object | conditional | Required for `server_managed` items |
| `encryptedItemKey` | string | conditional | Required for `zero_knowledge` items |
| `ciphertext` | string | conditional | Required for `zero_knowledge` items |

Returns `{ id }`.

### `items.list`

Auth: `sessionProcedure`

Returns `{ items }` with metadata only (no secret data). Each item summary includes `id`, `label`, `kind`, `storageMode`, `createdAt`.

### `items.get`

Auth: `sessionProcedure`

Input: `{ itemId }`. Returns `{ item }`.

### `items.update`

Auth: `sessionProcedure`

Input: `{ itemId, data }` where `data` contains updated fields and `contentVersion` for optimistic
concurrency. Returns `{ ok: true, contentVersion }`.

### `items.ownerReveal`

Auth: `sessionProcedure`

Input: `{ itemId }`. Decrypts and returns a server-managed item owned by the current user. Returns `{ payload }`. Fails on zero-knowledge items.

### `items.delete`

Auth: `sessionProcedure`

Input: `{ itemId }`. Soft-deletes the item. Returns `{ ok: true }`.

### `agents.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | enum | yes | `local_cli`, `local_mcp`, `remote` |
| `name` | string | yes | Display name |
| `authMethod` | enum | no | `public_key_session` (default) or `legacy_api_key` |
| `publicKey` | string | no | JWK-serialized Ed25519 public key for direct enrollment |
| `issueBootstrapToken` | boolean | no | Issue a one-time bootstrap token instead of direct enrollment |
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

* `authMethod` defaults to `public_key_session`
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

### `agents.rotate`

Auth: `sessionProcedure`

Input: `{ agentId }`. Rotates a legacy API key only. Returns `{ apiKey, keyPrefix }`.

### `agents.revoke`

Auth: `sessionProcedure`

Input: `{ agentId }`. Invalidates all active sessions. Returns `{ ok: true }`.

### `permissions.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Agent receiving access |
| `itemId` | string | yes | Target item |
| `capability` | enum | yes | `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file` |
| `expiresAt` | string | no | ISO timestamp for permission expiry |

Creation-time enforcement rejects:

* remote agent + zero-knowledge item (`INVALID_CAPABILITY_STORAGE`)
* remote agent + capability other than `reveal_plaintext` (`INVALID_CAPABILITY_LOCALITY`)

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

### `agents.self`

Auth: `agentProcedure`

Returns `{ agent }` for the currently authenticated agent.

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
| `field` | string | no | Named field to return (for multi-field items) |

Returns `{ payload }`.

Denied if: non-server-managed item, or missing `reveal_plaintext` permission.

For multi-field items where no `field` is specified, returns `MULTI_FIELD_ITEM` with available field
names in the hint. See [`docs/FIELDS.md`](./FIELDS.md).

### `access.mount`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `mountType` | `"env" \| "file"` | yes | Requested mount style |
| `field` | string | no | Named field to return (for multi-field items) |

Response:

* zero-knowledge item: `{ storageMode: "zero_knowledge", encryptedItemKey, ciphertext, cryptoVersion }`
* server-managed item: `{ storageMode: "server_managed", payload }`

Denied if: remote agent, or missing `mount_env`/`mount_file` permission.

## Audit events

| Category | Event types |
|---|---|
| Profile | `profile.create`, `profile.rotate`, `profile.delete`, `profile.delete_cascade` |
| Items | `item.create`, `item.read`, `item.update`, `item.delete`, `item.delete_cascade`, `item.export` |
| Auth | `auth.login`, `auth.logout`, `auth.token_issue`, `auth.token_revoke` |
| Agents | `agent.create`, `agent.bootstrap_issue`, `agent.enroll`, `agent.rotate`, `agent.revoke`, `agent.revoke_cascade`, `agent.session_issue`, `agent.session_reject`, `agent.session_revoke` |
| Permissions | `permission.create`, `permission.revoke`, `permission.revoke_cascade` |
| Access | `access.ciphertext`, `access.reveal`, `access.mount_env`, `access.mount_file` |

## Rate limiting

| Path | Limit |
|------|-------|
| `/api/auth/*` | 60 requests/minute per IP |
| `/trpc/*` | 100 requests/minute per IP |

## Health check

`GET /health` returns `{ "status": "ok" }`. No authentication required.

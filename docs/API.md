# API Reference

The canonical control-plane transport is REST at `/v1/...`. Every endpoint
is also reachable via tRPC at `/trpc/*`, but new integrations should target
the REST surface.

Base URL:

* production: `https://your-api-domain/v1`
* local development: `http://localhost:8787/v1`

The OpenAPI 3.1 spec is served at `/v1/openapi.json` and is generated from
the same procedure metadata that drives request routing — `/v1` and the
spec cannot disagree.

## Conventions

* **Content type**: `application/json` for request and response bodies.
* **Path params**: appear in curly braces (`/items/{itemId}`).
* **Query params**: cursor pagination uses `limit` (default 50, max 100) and
  `cursor` (opaque string returned in the previous page response).
* **Request IDs**: every response includes an `X-Request-Id` header. Clients
  may set their own; the server echoes it back. Always include the request ID
  when reporting issues.
* **Errors**: every non-2xx response is a JSON envelope (see below). HTTP
  status reflects error class. Validation errors carry `issues[]`.

## Authentication

All endpoints under `/v1/*` use `Authorization: Bearer <token>` unless the
table marks an endpoint as unauthenticated (agent enrollment + session
exchange). The bearer token may be:

| Prefix | Holder | Issuer |
|--------|--------|--------|
| Better Auth session token | Human operator | `/api/auth/sign-in/*` |
| `abs_...` | Agent session | `POST /v1/agents/{agentId}/sessions/exchange` |
| legacy API key | Agent (legacy) | `POST /v1/agents` with `authMethod=legacy_api_key` |

`abs_...` tokens are opaque, hashed at rest, and expire after 15 minutes.
The TypeScript SDK refreshes them automatically at T-2 minutes.

### Org scoping

Most endpoints are scoped to an organization. The server resolves the
caller's org in this order:

1. `X-Abadge-Org-Id` header (required for users with more than one org)
2. The single org the caller belongs to (when unambiguous)
3. The org embedded in the bearer credential (agent sessions and API keys)

If a user belongs to multiple orgs and omits `X-Abadge-Org-Id`, the server
returns `400 BAD_REQUEST` with `code: "ORG_HEADER_REQUIRED"`.

## Error envelope

```json
{
  "code": "ITEM_NOT_FOUND",
  "message": "Item not found.",
  "hint": "Verify the item ID and that it belongs to your organization.",
  "meta": {}
}
```

Validation errors add an `issues` array:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid input.",
  "hint": "Check the invalid fields and try again.",
  "issues": [{ "path": ["itemId"], "message": "Required" }],
  "meta": {}
}
```

All error codes are listed in [`docs/ERRORS.md`](./ERRORS.md). The TypeScript
SDK surfaces the envelope as `AbadgeApiError` with `statusCode`, `code`,
`hint`, `meta`, and `issues`.

## Rate limits

| Bucket | Limit | Headers |
|--------|-------|---------|
| Better Auth (`/api/auth/*`) | 60 / minute / IP | `Retry-After` on 429 |
| Application (`/v1/*` and `/trpc/*`) | 100 / minute / principal | `Retry-After` on 429 |

The principal is the bearer token (or IP for unauthenticated routes).

## Endpoints

### Organizations

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/orgs` | session | Create an organization. Auto-creates a default `server_managed` profile (`externalId: "default"`). Response includes `defaultProfile`. |
| `GET` | `/v1/orgs` | session | List organizations the caller belongs to. |
| `GET` | `/v1/orgs/{orgId}` | session | Fetch a single organization. |
| `PATCH` | `/v1/orgs/{orgId}` | session (admin) | Update name, slug, or logo. |
| `DELETE` | `/v1/orgs/{orgId}` | session (owner) | Soft-delete the organization. |

### Members & invites

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/orgs/{orgId}/members` | session | List members of the org. |
| `POST` | `/v1/orgs/{orgId}/members` | session (admin) | Invite a new member by email. Returns an `abi_...` invite token. |
| `POST` | `/v1/invites/accept` | session | Accept an invite by token (`abi_...`). |
| `DELETE` | `/v1/orgs/{orgId}/members/{memberId}` | session (admin) | Remove a member; cascade-revokes their agents. |
| `PATCH` | `/v1/orgs/{orgId}/members/{memberId}` | session (admin) | Change a member's role. |

### Profiles

Profiles are the encryption boundary within an org. A new org always has a
`server_managed` profile with `externalId: "default"`. Additional profiles
support either storage mode and may carry a customer-supplied `externalId`.

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/orgs/{orgId}/profiles` | session (admin) | Create a profile. Accepts `name`, optional `description`, `storageMode`. |
| `GET` | `/v1/orgs/{orgId}/profiles` | session | List profiles in the org. |
| `GET` | `/v1/profiles/{profileId}` | session | Get a single profile. |
| `POST` | `/v1/profiles/{profileId}/bootstrap` | session (admin) | Bootstrap a `zero_knowledge` profile with a client-derived wrapped root key. |
| `POST` | `/v1/profiles/{profileId}/rotate` | session (admin) | Rotate the profile's root key. |
| `DELETE` | `/v1/profiles/{profileId}` | session (admin) | Delete a profile and cascade-delete its items. |

### Items

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/items` | session/agent (`items:write`) | Create an item in a profile. For ZK items, supply `encryptedItemKey` + `ciphertext`; for server-managed items, supply `payload`. |
| `GET` | `/v1/items` | session/agent (`items:read`) | List items. Supports `profileId`, `limit`, `cursor`. |
| `GET` | `/v1/items/{itemId}` | session/agent | Fetch a single item's metadata + (for ZK) ciphertext. |
| `PATCH` | `/v1/items/{itemId}` | session (admin) | Update an item's label or payload. Uses optimistic concurrency via `contentVersion`. |
| `DELETE` | `/v1/items/{itemId}` | session (admin) | Soft-delete an item. |

### Agents

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/agents` | session (admin) | Register an agent. Default `authMethod=public_key_session`; pass `issueBootstrapToken: true` for unenrolled keypair agents, or `authMethod=legacy_api_key` to receive a one-time API key. |
| `GET` | `/v1/agents` | session | List agents in the org. |
| `GET` | `/v1/agents/{agentId}` | session | Fetch agent details. |
| `DELETE` | `/v1/agents/{agentId}` | session (admin) | Revoke an agent; cascade-revokes its permissions. |

### Agent enrollment & sessions (public)

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/agents/{agentId}/bootstrap` | session (admin) | Issue a one-time `abe_...` bootstrap token. |
| `POST` | `/v1/agents/enroll` | none | Redeem bootstrap token + upload an Ed25519 public key. |
| `POST` | `/v1/agents/{agentId}/sessions/challenge` | none | Create a short-lived signing challenge (`abc_...`, 60 s TTL). |
| `POST` | `/v1/agents/{agentId}/sessions/exchange` | none | Exchange a signed challenge for an `abs_...` session token. |
| `DELETE` | `/v1/agents/sessions/{token}` | agent | Revoke the current session. |

### Permissions (grants)

The canonical capabilities are `read` and `use`. Legacy capability names
(`read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`) remain
accepted as aliases and normalize to `read`/`use` on the server. See
[`CAPABILITIES.md`](./CAPABILITIES.md).

`POST /v1/permissions` accepts either an item target or a profile target.
All capabilities in a single request commit as one transaction; partial
grants are never observable.

Item target:

```json
{
  "agentId": "agt_...",
  "itemId": "itm_...",
  "capabilities": ["read"],
  "expiresAt": "2026-12-31T00:00:00.000Z"
}
```

Profile target (grants apply to every current and future item in the
profile):

```json
{
  "agentId": "agt_...",
  "profileId": "prf_...",
  "capabilities": ["use"]
}
```

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/permissions` | session (admin) | Create one or more grants atomically. |
| `GET` | `/v1/permissions` | session | List grants. Supports `agentId`, `itemId`, `profileId` filters. |
| `DELETE` | `/v1/permissions/{permissionId}` | session (admin) | Revoke a single grant. |

### Access (agent-facing)

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/access/{itemId}/read` | agent | Read a single item. Returns the server-decrypted payload (server-managed) or the ZK envelope (zero-knowledge). Optional `field` for field selection. |
| `POST` | `/v1/access/{itemId}/use` | agent | Reserve a mount handle for an item. Body: `delivery: "env" \| "file"`, optional `envVarName`, `field`. Returns an opaque `mountId` and `expiresAt`. |
| `POST` | `/v1/profiles/{profileId}/access/use` | agent | Reserve a mount handle for every item in a profile (bulk env injection). Returns a single mount with one entry per item. |
| `POST` | `/v1/access/mounts/{mountId}/redeem` | agent | Redeem a mount handle. Used by the daemon to consume the reservation; returns the decrypted payload + delivery hints. One-shot; redemption deletes the reservation. |

The `field` parameter selects a single field from a multi-field payload.
See [`docs/FIELDS.md`](./FIELDS.md) for resolution rules.

### Audit

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/audit` | session (audit:read) | List audit events. Supports `agentId`, `itemId`, `profileId`, `result`, `eventType`, `since`, `until`, `limit`, `cursor`. |

### Health

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/health` | none | Liveness probe. Returns `{ "status": "ok" }`. |

## Pagination

List endpoints accept `limit` (default 50, max 100) and `cursor` (opaque).
The response shape is:

```json
{
  "items": [/* ... */],
  "nextCursor": "..." | null
}
```

When `nextCursor` is `null`, the page is the last page.

## tRPC bridge

Every REST route is also reachable via tRPC at `/trpc/<router>.<procedure>`.
The transport differs (POST with `input` in body for mutations; GET with
`input` query-string for queries) but the input/output shapes are
identical. New integrations should prefer REST; the tRPC bridge exists for
internal callers (web dashboard, CLI, SDK) that already speak tRPC.

The Better Auth surface remains at `/api/auth/*` and is not part of `/v1`.

## SDKs

* **TypeScript**: `@abadge/sdk` exports `Abadge.User` (session-authed) and
  `Abadge.Agent` (agent-session-authed). See [`docs/CLI.md`](./CLI.md) for
  usage examples.
* **CLI**: `abadge` binary, distributed via Homebrew and `npx`. See
  [`docs/CLI.md`](./CLI.md).
* **MCP**: stdio MCP server for AI agents. See [`docs/MCP.md`](./MCP.md).

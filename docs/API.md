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
| `abu_...` | Personal API key (user + org) | `POST /v1/api-keys` |
| `abs_...` | Agent session | `POST /v1/agents/{agentId}/sessions/exchange` |

`abs_...` tokens are opaque, hashed at rest, and expire after 15 minutes.
The TypeScript SDK refreshes them automatically at T-2 minutes.

An `abu_...` personal API key authenticates the **management surface only**
— the same procedures the dashboard uses (organizations, profiles, items
metadata, agents, permissions, audit, settings). It resolves to a
**session identity**, not an agent identity, so it can never reach the
agent-gated `access.*` surface and cannot reveal or mount secret values.
Reading secret values still requires a keypair agent plus an explicit
permission. A personal API key also cannot create or revoke other API keys
— that requires a real browser session.

### Org scoping

Most endpoints are scoped to an organization. The server resolves the
caller's org in this order:

1. `X-Abadge-Org-Id` header (required for users with more than one org)
2. The single org the caller belongs to (when unambiguous)
3. The org embedded in the bearer credential (agent sessions and personal API keys are both bound to a single org)

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
| `POST` | `/v1/orgs/personal` | session | Create a personal account (no request body). Auto-generates name/slug, flags the org personal (`metadata`), and seeds the same default `server_managed` profile. Same response shape as `POST /v1/orgs`, with `organization.isPersonal: true`. |
| `GET` | `/v1/orgs` | session | List organizations the caller belongs to. |
| `GET` | `/v1/orgs/{orgId}` | session | Fetch a single organization. |
| `PATCH` | `/v1/orgs/{orgId}` | session (admin) | Update name, slug, or logo. |
| `DELETE` | `/v1/orgs/{orgId}` | session (owner) | Soft-delete the organization. |

Organization responses (`POST /v1/orgs`, `POST /v1/orgs/personal`, `GET /v1/orgs`, `GET /v1/orgs/{orgId}`) carry an `isPersonal` boolean. A personal account is a normal single-member org flagged via `organization.metadata`; it is presented in the dashboard as a personal account, holds exactly one profile (additional profiles are rejected with `PROFILE_LIMIT_EXCEEDED` for personal accounts; team orgs are uncapped), can hold many agents, and may coexist with team orgs the user creates or joins later.

### Members & invites

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/orgs/{orgId}/members` | session | List members of the org. |
| `POST` | `/v1/orgs/{orgId}/members` | session (admin) | Invite a new member by email. Returns an `abi_...` invite token. |
| `POST` | `/v1/invites/accept` | session | Accept an invite by token (`abi_...`). |
| `DELETE` | `/v1/orgs/{orgId}/members/{memberId}` | session (admin) | Remove a member; cascade-revokes their agents. |
| `PATCH` | `/v1/orgs/{orgId}/members/{memberId}` | session (admin) | Change a member's role. |

### API keys

Personal API keys (`abu_...`) authenticate the management surface as the
issuing user, scoped to one org. They resolve to a **session identity** —
they call the same `sessionProcedure` surface the dashboard does
(organizations, profiles, items metadata, agents, permissions, audit,
settings). They can **never** reach the agent-gated `access.*` surface, so
they cannot reveal or mount secret values; that still requires a keypair
agent plus an explicit permission. They are created, listed, and revoked
from the dashboard org Settings page. A personal API key cannot create or
revoke other API keys (that needs a real browser session).

The secret is shown exactly once at creation. The server stores a SHA-256
hash plus an 8-character lookup prefix. Keys support an optional `expiresAt`
and can be revoked.

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/api-keys` | session (browser) | Create a personal API key. Accepts `name`, optional `expiresAt`. Returns the full `abu_...` secret once, plus the key record. |
| `GET` | `/v1/api-keys` | session | List the caller's personal API keys in the active org (secrets never returned). |
| `DELETE` | `/v1/api-keys/{keyId}` | session (browser) | Revoke a personal API key. |

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
| `POST` | `/v1/agents` | session (admin) | Register an agent. Agents use `public_key_session` (Ed25519); provide `publicKey` directly or pass `issueBootstrapToken: true` for unenrolled keypair agents. |
| `GET` | `/v1/agents` | session | List agents in the org. Supports `limit`, `cursor`. |
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

### auth.md agentic registration (public)

Implements the WorkOS [auth.md](https://workos.com/auth-md) `anonymous` → user-claimed (OTP)
flow: an agent self-registers a personal account on a person's behalf, then the
human claims it with an emailed 6-digit code. Discovery is two-hop (RFC 9728); a
401 from any route carries `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/.well-known/oauth-protected-resource` | none | Protected Resource Metadata. |
| `GET` | `/.well-known/oauth-authorization-server` | none | Auth Server Metadata incl. the `agent_auth` block. |
| `GET` | `/auth.md` | none | Markdown skill manifest for agents. |
| `POST` | `/agent/auth` | none | Register anonymously. Provisions an unclaimed personal account (placeholder-email owner + org + default profile) and returns an `abu_` personal API key + a `clm_` claim token. |
| `POST` | `/agent/auth/claim` | none | `{ claim_token, email }` → emails the owner a 6-digit code. |
| `POST` | `/agent/auth/claim/complete` | none | `{ claim_token, otp }` → binds the human's verified email to the account in place. |

The issued credential is a standard `abu_` personal API key (see *Personal API keys*):
a management-surface session bound to the new account, so the agent manages the
person's credentials through the normal `items` / `profiles` surface (including
personal-account owner-reveal). It never reaches the agent-gated `access.*` surface.
Rate limit: 60/min/IP; unclaimed accounts are garbage-collected after 24 h.

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
| `GET` | `/v1/permissions` | session | List grants. Supports `agentId`, `itemId`, `profileId` filters plus `limit`, `cursor`. |
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

Exactly these four list endpoints support cursor (keyset) pagination. Each
accepts optional `limit` (default 50, max 100) and `cursor`, and returns the
result array under its own key alongside `nextCursor`:

| Endpoint | Array key |
|----------|-----------|
| `GET /v1/items` | `items` |
| `GET /v1/agents` | `agents` |
| `GET /v1/permissions` | `permissions` |
| `GET /v1/audit` | `entries` |

The response shape (using `/v1/items` as the example):

```json
{
  "items": [/* ... */],
  "nextCursor": "..." | null
}
```

* **`cursor` is opaque.** Pass back the exact `nextCursor` from the previous
  page; never construct or parse it. The encoding is an implementation detail
  and may change.
* **Ordering is newest-first by creation time.** Pages are a stable keyset, so
  rows are neither dropped nor duplicated across page boundaries even while new
  records are being inserted concurrently.
* **`nextCursor: null` means the last page.** Stop when it is `null`.
* **Other list endpoints are not paginated.** Organizations, members, and
  profiles return their full set in a single response.

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

# API Specification

The control plane exposes two HTTP surfaces:

| Surface | Path | Purpose |
|---------|------|---------|
| Authentication | `/api/auth/*` | human authentication and device authorization |
| tRPC | `/trpc/*` | canonical typed application API |

The tRPC surface is the canonical application transport. REST compatibility routes may delegate to it,
but the auth redesign is defined against `/api/auth/*` and the tRPC routers.

## Human authentication

The authentication system is the source of truth for operator identity.

Supported routes include:

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
POST /api/auth/sign-out
GET  /api/auth/get-session
POST /api/auth/device/code
POST /api/auth/device/token
GET  /api/auth/device?user_code=...
POST /api/auth/device/approve
POST /api/auth/device/deny
```

Operator-facing tRPC procedures accept:

* Session cookies
* Bearer access tokens in `Authorization: Bearer ...`

The CLI device-login bearer token is not persisted to disk.

### Device authorization flow

1. CLI calls `POST /api/auth/device/code`
2. user authenticates in the browser and approves the code
3. CLI polls `POST /api/auth/device/token`
4. CLI validates with `GET /api/auth/get-session`
5. CLI stores session state only in daemon memory

`/api/auth/device/approve` and `/api/auth/device/deny` require an authenticated browser session.

## Agent authentication

Agent-facing procedures accept a Bearer `abs_...` short-lived session token,
looked up in `agent_sessions` by hash. It is the only agent auth method.

`abs_...` tokens are opaque, hashed at rest, and expire after 15 minutes by default.

Management-surface procedures (`sessionProcedure`) additionally accept a
personal API key (`abu_...`). It resolves to a session identity scoped to the
key's org and never reaches the agent-gated `access.*` surface.

## Agent enrollment and short-lived session lifecycle

Keypair-backed agents use these tRPC procedures:

| Procedure | Auth | Description |
|-----------|------|-------------|
| `auth.issueBootstrapToken` | session | Issue a one-time `abe_...` enrollment token |
| `auth.enroll` | public | Redeem bootstrap token and upload an agent public key |
| `auth.createChallenge` | public | Create a short-lived signing challenge |
| `auth.exchangeSession` | public | Verify the signature and mint an `abs_...` session |
| `auth.revokeSession` | session | Revoke an active `abs_...` session for the current operator |
| `auth.recordLogin` | session | Record `auth.login` audit event |
| `auth.logout` | session | Record `auth.logout` audit event |

Defaults:

* new remote agents default to `public_key_session`
* bootstrap tokens are single-use and expire after 10 minutes
* signing challenges expire after 60 seconds
* agent sessions expire after 15 minutes

## Procedure tiers

| Tier | Auth | Used by |
|------|------|---------|
| `publicProcedure` | none | enrollment and agent session exchange |
| `sessionProcedure` | operator session | dashboard, CLI management commands, SDK |
| `agentProcedure` | agent credential | runtime agents, MCP, remote agents |

## Selected procedures

### `agents.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Display name |
| `kind` | enum | yes | `local_cli`, `local_mcp`, `remote` |
| `authMethod` | enum | no | `public_key_session` (only value; default) |
| `publicKey` | string | no | Serialized JWK public key |
| `issueBootstrapToken` | boolean | no | Issue one-time bootstrap token |
| `metadata` | object | no | Free-form metadata |

Response:

```ts
{
  agent: Agent;
  bootstrapToken: string | null;
  bootstrapExpiresAt: string | null;
}
```

### `apiKeys.create` / `apiKeys.list` / `apiKeys.revoke`

Auth: `sessionProcedure`

Manage personal API keys (`abu_...`) bound to the caller's `(user, org)`
pair. `create` returns the full secret once; the server stores a SHA-256
hash plus an 8-character prefix. `list` never returns secrets. `revoke`
disables a key. A personal API key resolves to a session identity and can
never reach `access.*`; it also cannot create or revoke other API keys.

### `access.mount`

Auth: `agentProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `mountType` | `"env" | "file"` | yes | Requested delivery mode |

### `access.reveal`

Auth: `agentProcedure`

Returns plaintext only for capabilities and storage modes that the policy matrix allows.

### `access.ciphertext`

Auth: `agentProcedure`

Returns encrypted payload material only for authorized local zero-knowledge flows.

## Audit events

The auth redesign adds these audit event types:

* `auth.login`
* `auth.logout`
* `agent.bootstrap_issue`
* `agent.enroll`
* `agent.session_issue`
* `agent.session_reject`
* `agent.session_revoke`

Access-allow and access-deny events remain required for every secret access attempt.

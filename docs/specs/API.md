# API Specification

The control plane exposes two HTTP surfaces:

| Surface | Path | Purpose |
|---------|------|---------|
| Better Auth | `/api/auth/*` | human authentication and device authorization |
| tRPC | `/trpc/*` | canonical typed application API |

The tRPC surface is the canonical application transport. REST compatibility routes may delegate to it,
but the auth redesign is defined against `/api/auth/*` and the tRPC routers.

## Human authentication

Better Auth remains the source of truth for operator identity.

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

* Better Auth browser cookies
* Better Auth bearer access tokens in `Authorization: Bearer ...`

The CLI device-login bearer token is not persisted to disk.

### Device authorization flow

1. CLI calls `POST /api/auth/device/code`
2. user authenticates in the browser and approves the code
3. CLI polls `POST /api/auth/device/token`
4. CLI validates with `GET /api/auth/get-session`
5. CLI stores session state only in daemon memory

`/api/auth/device/approve` and `/api/auth/device/deny` require an authenticated browser session.

## Agent authentication

Agent-facing procedures accept Bearer credentials and resolve them in this order:

1. `abs_...` short-lived session token lookup in `agent_sessions`
2. legacy `abl_...` or `abg_...` API-key verification by prefix and hash
3. legacy Better Auth API-key fallback for migrated principals

`abs_...` tokens are opaque, hashed at rest, and expire after 15 minutes by default.

## Agent enrollment and short-lived session lifecycle

Keypair-backed agents use these tRPC procedures:

| Procedure | Auth | Description |
|-----------|------|-------------|
| `auth.issueBootstrapToken` | session | Issue a one-time `abe_...` enrollment token |
| `auth.enroll` | public | Redeem bootstrap token and upload an agent public key |
| `auth.createChallenge` | public | Create a short-lived signing challenge |
| `auth.exchangeSession` | public | Verify the signature and mint an `abs_...` session |
| `auth.revokeSession` | public | Revoke an active `abs_...` session |
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
| `kind` | enum | yes | `device`, `local_cli`, `local_mcp`, `remote_agent` |
| `authMethod` | enum | no | `public_key_session` or `legacy_api_key` |
| `publicKey` | string | no | Serialized JWK public key |
| `issueBootstrapToken` | boolean | no | Issue one-time bootstrap token |
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

### `agents.rotate`

Auth: `sessionProcedure`

Rotates a legacy API key only.

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

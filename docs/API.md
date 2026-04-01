# API Reference

The REST API is the canonical control plane for abadge. The dashboard, CLI, SDK, and integrations
all build on these routes.

Base URL: `https://your-api-domain` (local dev: `http://localhost:8787`)

## Authentication

### User sessions

Dashboard and management routes use Better Auth session cookies. Authenticate via:

```
POST /api/auth/sign-up/email   { name, email, password }
POST /api/auth/sign-in/email   { email, password }
GET  /api/auth/get-session
POST /api/auth/sign-out
```

Social login (when configured):

```
GET /api/auth/sign-in/social   { provider: "github" | "google" }
```

All `/v1/*` management routes require a valid session cookie unless noted otherwise.

### Social auth providers

```
GET /v1/auth/providers
```

Auth: none (public). Returns configured social login providers so the dashboard can render
available login options.

Response: `{ providers: ("github" | "google")[] }`

### Agent auth

Agent-facing routes accept a Bearer token in the `Authorization` header:

```
Authorization: Bearer abg_...   (API key)
Authorization: Bearer abs_...   (broker session token)
```

Session tokens are tried first (by `abs_` prefix), then API keys.

---

## Credentials

All routes require user session auth.

### List credentials

```
GET /v1/credentials
```

Response: `{ credentials: Credential[] }`

Encrypted value and IV are never returned.

### Get credential

```
GET /v1/credentials/:id
```

Response: `{ credential: Credential }`

Encrypted value and IV are never returned.

### Create credential

```
POST /v1/credentials
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-128) | yes | Display name (unique per user) |
| `type` | enum | yes | api\_key, login, token, json\_blob, oauth\_client, service\_account\_json, cookie\_session, pii, other |
| `value` | string (1-65536) | conditional | Secret value (encrypted at rest). Required when sourceType is "native". |
| `metadata` | Record\<string, string> | no | Arbitrary key-value pairs |
| `ownerScope` | enum | no | user, org, system (default: user) |
| `orgId` | string | no | Organization ID for team-owned credentials |
| `environment` | enum | no | dev, staging, prod |
| `service` | string (max 128) | no | e.g., "github", "aws" |
| `provider` | string (max 128) | no | e.g., "cloud", "saas" |
| `project` | string (max 128) | no | Project identifier |
| `tags` | string\[] (max 20, each max 64) | no | Searchable tags |
| `sensitivity` | enum | no | low, medium, high, critical (default: medium) |
| `allowedDeliveryModes` | DeliveryMode\[] (min 1) | no | Restrict how this credential can be consumed |
| `allowedDestinations` | string\[] (max 50, each max 256) | no | Restrict where this credential can be sent |
| `sourceType` | enum | no | native (default) or external |
| `connectorId` | string | conditional | Required when sourceType is "external" |
| `externalRef` | ExternalRef | no | Reference to secret in external vault |

**ExternalRef fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Secret name in external vault |
| `path` | string | Secret path in external vault |
| `version` | string | Secret version |

When `sourceType` is "native", `value` is required and encrypted at rest. When `sourceType` is "external", `connectorId` is required and the value is fetched from the external vault at access time.

Response: `{ credential: { id, name } }` (201)

### Update credential

```
PUT /v1/credentials/:id
```

Same fields as create, all optional. If `value` is provided, it is re-encrypted. Set nullable fields to `null` to clear them.

Response: `{ credential: { id, name } }`

### Delete credential

```
DELETE /v1/credentials/:id
```

Response: `{ success: true }`

---

## Agents

All routes require user session auth. Agents are API keys managed via Better Auth.

### List agents

```
GET /v1/agents
```

Response: `{ agents: Agent[] }`

Each agent includes: id, name, prefix, start, enabled, lastRequest, metadata, createdAt.

### Register agent

```
POST /v1/agents
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-64) | yes | Agent display name |
| `description` | string (max 256) | no | Stored in metadata |

Response: `{ agent: { id, name, prefix }, apiKey: "abg_..." }` (201)

The API key is shown **once**. Only the hash is stored.

### Update agent

```
PATCH /v1/agents/:id
```

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable/disable the agent |
| `name` | string | Update display name |
| `description` | string | Update description in metadata |

Response: `{ success: true }`

### Delete agent

```
DELETE /v1/agents/:id
```

Response: `{ success: true }`

---

## Permissions

All routes require user session auth.

### List permissions for credential

```
GET /v1/permissions/credential/:credentialId
```

Response: `{ permissions: Permission[] }`

Each permission includes joined agent name and enabled status.

### Grant permission

```
POST /v1/permissions/grant
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | Agent to grant access to |
| `credentialId` | uuid | yes | Credential to grant access to |
| `policyId` | uuid | no | Attach a policy to this grant |
| `allowedDeliveryModes` | DeliveryMode\[] (min 1) | no | Restrict delivery modes for this grant |
| `expiresAt` | ISO date | no | Permission expiration |

Both agent and credential must belong to the authenticated user. Returns 409 if the permission already exists.

Response: `{ success: true }` (201)

### Revoke permission

```
POST /v1/permissions/revoke
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | Agent to revoke from |
| `credentialId` | uuid | yes | Credential to revoke access to |

Response: `{ success: true }`

---

## Policies

All routes require user session auth.

### List policies

```
GET /v1/policies
```

Response: `{ policies: Policy[] }`

### Get policy

```
GET /v1/policies/:id
```

Response: `{ policy: Policy }`

### Create policy

```
POST /v1/policies
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-128) | yes | Policy name |
| `credentialId` | uuid | no | Scope to a credential (global if omitted) |
| `rules` | PolicyRule\[] (min 1) | yes | Access rules |

**PolicyRule types:**

```jsonc
// Restrict delivery modes
{ "type": "delivery_mode", "deliveryModes": ["env_inject", "file_mount"] }

// Restrict environments
{ "type": "environment", "environments": ["prod"] }

// Require approval above sensitivity threshold
{ "type": "sensitivity", "requiresApproval": true, "sensitivity": "high" }

// Restrict destinations
{ "type": "destination", "destinations": ["*.internal.com"], "blockedDestinations": ["*.public.com"] }

// Limit session TTL
{ "type": "ttl", "ttlSeconds": 3600 }
```

Response: `{ policy: Policy }` (201)

### Update policy

```
PUT /v1/policies/:id
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (1-128) | Policy name |
| `credentialId` | uuid (nullable) | Scope to credential or set null for global |
| `rules` | PolicyRule\[] (min 1) | Access rules |
| `enabled` | boolean | Enable/disable |

Response: `{ policy: Policy }`

### Delete policy

```
DELETE /v1/policies/:id
```

Response: `{ success: true }`

---

## Approvals

All routes require user session auth. Only the credential owner can approve/deny.

### List approvals

```
GET /v1/approvals?status=pending
```

| Query param | Type | Description |
|-------------|------|-------------|
| `status` | enum | pending, approved, denied, expired |

Response: `{ approvals: Approval[] }`

### Get approval

```
GET /v1/approvals/:id
```

Response: `{ approval: Approval }`

### Approve

```
POST /v1/approvals/:id/approve
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string (max 512) | no | Approval reason |

Returns 409 if the approval is not pending or has expired.

Response: `{ success: true }`

### Deny

```
POST /v1/approvals/:id/deny
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string (max 512) | no | Denial reason |

Returns 409 if the approval is not pending or has expired.

Response: `{ success: true }`

---

## Connectors

All routes require user session auth. Connector configs are encrypted at rest.

### List connectors

```
GET /v1/connectors
```

Response: `{ connectors: Connector[] }` (config is never returned)

### Get connector

```
GET /v1/connectors/:id
```

Response: `{ connector: Connector }` (config is never returned)

### Create connector

```
POST /v1/connectors
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-128) | yes | Display name |
| `type` | enum | yes | native, onepassword, aws\_secrets\_manager, bitwarden, infisical, doppler, gcloud\_secret\_manager, hashicorp\_vault |
| `config` | Record\<string, string> | no | Connector configuration (encrypted at rest) |

Response: `{ connector: { id, name } }` (201)

### Update connector

```
PUT /v1/connectors/:id
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (1-128) | Display name |
| `config` | Record\<string, string> | Re-encrypted at rest |
| `enabled` | boolean | Enable/disable |

Response: `{ connector: { id, name } }`

### Delete connector

```
DELETE /v1/connectors/:id
```

Response: `{ success: true }`

### Test connector

```
POST /v1/connectors/:id/test
```

Tests connectivity without fetching secrets. HTTP connectors (Doppler, HashiCorp Vault, Infisical) are tested server-side. Client-side connectors (1Password, AWS, etc.) require the local broker.

Response: `{ success: boolean, error?: string }`

---

## Auto-Grants

All routes require user session auth. Auto-grants define rules that automatically grant permissions to an agent for any credential matching specified criteria.

### List auto-grants

```
GET /v1/auto-grants
```

Response: `{ autoGrants: AutoGrant[] }`

### Get auto-grant

```
GET /v1/auto-grants/:id
```

Response: `{ autoGrant: AutoGrant }`

### Create auto-grant

```
POST /v1/auto-grants
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | Agent to grant access to |
| `matchEnvironment` | enum | no | Match credentials in this environment (dev, staging, prod) |
| `matchTags` | string\[] (max 20) | no | Match credentials with ALL of these tags |
| `matchType` | enum | no | Match credentials of this type |
| `matchService` | string (max 128) | no | Match credentials for this service |
| `matchSensitivity` | enum | no | Match credentials at this sensitivity level |
| `policyId` | uuid | no | Attach this policy to auto-granted permissions |
| `allowedDeliveryModes` | DeliveryMode\[] (min 1) | no | Restrict delivery modes for auto-granted permissions |
| `expiresAt` | ISO date | no | Expiration for auto-granted permissions |

Matching is conjunctive: a credential must match ALL non-null criteria. For `matchTags`, the credential must have all specified tags (subset check).

Response: `{ autoGrant: AutoGrant }` (201)

### Update auto-grant

```
PUT /v1/auto-grants/:id
```

Same fields as create (except `agentId`), all optional. Set a field to `null` to clear it.

Response: `{ autoGrant: AutoGrant }`

### Delete auto-grant

```
DELETE /v1/auto-grants/:id
```

Response: `{ success: true }`

---

## Agent Groups

All routes require user session auth. Agent groups organize agents into named collections.

### List agent groups

```
GET /v1/agent-groups
```

Response: `{ groups: AgentGroup[] }`

### Create agent group

```
POST /v1/agent-groups
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-128) | yes | Group name |
| `description` | string (max 512) | no | Group description |

Response: `{ group: AgentGroup }` (201)

### Get agent group

```
GET /v1/agent-groups/:id
```

Response: `{ group: AgentGroup, members: AgentGroupMember[] }`

### Update agent group

```
PUT /v1/agent-groups/:id
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (1-128) | Group name |
| `description` | string (max 512, nullable) | Group description |

Response: `{ group: AgentGroup }`

### Delete agent group

```
DELETE /v1/agent-groups/:id
```

Deleting a group cascades to remove all member associations.

Response: `{ success: true }`

### Add member to group

```
POST /v1/agent-groups/:id/members
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | Agent to add |

Returns 409 if the agent is already a member.

Response: `{ member: AgentGroupMember }` (201)

### Remove member from group

```
DELETE /v1/agent-groups/:id/members/:agentId
```

Response: `{ success: true }`

---

## Broker Sessions

All routes require agent auth (API key Bearer token).

### Create session

```
POST /v1/sessions
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | string | yes | Agent to create session for |
| `scopes` | string\[] (each max 128) | no | Credential IDs to restrict access |
| `allowedDeliveryModes` | DeliveryMode\[] | no | Delivery mode constraints |
| `ttlSeconds` | number (1-86400) | yes | Session lifetime in seconds |

The requesting agent must own or share a user with the target agent.

Response: `{ sessionId, token: "abs_...", expiresAt }` (201)

The token is shown **once**. Only the hash is stored.

### List sessions

```
GET /v1/sessions
```

Returns active (non-expired, non-revoked) sessions for the authenticated agent.

Response: `{ sessions: Session[] }`

### Get session

```
GET /v1/sessions/:id
```

Response: `{ session: Session }`

### Revoke session

```
DELETE /v1/sessions/:id
```

Response: `{ success: true }`

---

## Credential Access (Agent-facing)

Requires agent auth (API key or broker session token).

### Access credential

```
POST /v1/credentials/access
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialName` | string (1-128) | one of name or id | Credential by name |
| `credentialId` | uuid | one of name or id | Credential by ID |
| `deliveryMode` | DeliveryMode | no | Default: env\_inject |
| `purpose` | string (max 512) | no | Reason for access (logged) |
| `destination` | string (max 256) | no | Where the credential will be sent |
| `environment` | enum | no | dev, staging, prod |
| `sessionId` | uuid | no | Broker session ID |

**Authorization flow:**

1. Authenticate agent (API key or session token)
2. Resolve credential (must belong to agent's owner)
3. Check explicit permission or matching auto-grant
4. Check permission expiration
5. Evaluate attached policy (if any)
6. Check delivery mode against credential, permission, and policy constraints
7. Log access attempt (allowed or denied)
8. Decrypt and return value only for reveal, env\_inject, or file\_mount modes

**Responses:**

Value-returning modes (reveal, env\_inject, file\_mount):

```json
{
  "credential": { "name": "...", "type": "...", "metadata": {} },
  "deliveryMode": "env_inject",
  "value": "decrypted_plaintext",
  "approved": true
}
```

Non-value modes (browser\_fill, operation\_only):

```json
{
  "credential": { "name": "...", "type": "...", "metadata": {} },
  "deliveryMode": "operation_only",
  "approved": true
}
```

Approval required (202):

```json
{
  "error": "Approval required",
  "code": "PENDING_APPROVAL",
  "approvalId": "uuid"
}
```

Denied (403):

```json
{ "error": "Access denied" }
{ "error": "Delivery mode not allowed", "code": "DELIVERY_MODE_NOT_ALLOWED" }
{ "error": "...", "code": "POLICY_VIOLATION" }
```

---

## Audit Log

Requires user session auth.

### Query audit log

```
GET /v1/audit
```

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | number (max 200) | Results per page (default: 50) |
| `offset` | number | Pagination offset (default: 0) |
| `outcome` | enum | allowed, denied, pending\_approval, expired |
| `deliveryMode` | DeliveryMode | Filter by delivery mode |
| `principalType` | enum | human, app, agent, workload |
| `environment` | enum | dev, staging, prod |
| `agentId` | string | Filter by agent |
| `startDate` | ISO date | Start of date range |
| `endDate` | ISO date | End of date range |

Returns logs for all credentials owned by the authenticated user. Returns empty if the user has no credentials.

Response: `{ logs: AccessLogEntry[] }`

---

## Delivery Modes

| Mode | Description | Value returned? |
|------|-------------|-----------------|
| `reveal` | Return decrypted plaintext | Yes |
| `env_inject` | Inject into subprocess environment | Yes (broker injects) |
| `file_mount` | Write to temp file (0600 perms) | Yes (broker writes) |
| `browser_fill` | Fill browser form fields | No (metadata only) |
| `operation_only` | Server-side operation only | No |

Default delivery mode for agent access is `env_inject`.

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `CREDENTIAL_NOT_FOUND` | 404 | Credential does not exist or is not owned by this user |
| `ACCESS_DENIED` | 403 | No permission grant exists |
| `AGENT_NOT_FOUND` | 404 | Agent does not exist |
| `AGENT_INACTIVE` | 401 | Agent is disabled |
| `INVALID_API_KEY` | 401 | API key or session token is invalid |
| `PERMISSION_EXISTS` | 409 | Duplicate permission grant |
| `PERMISSION_NOT_FOUND` | 404 | Permission does not exist |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `RATE_LIMITED` | 429 | Too many requests |
| `VALIDATION_ERROR` | 400 | Request body failed Zod validation |
| `POLICY_VIOLATION` | 403 | Policy blocks the requested action |
| `APPROVAL_REQUIRED` | 202 | Access requires human approval |
| `APPROVAL_EXPIRED` | 409 | Approval has expired |
| `DELIVERY_MODE_NOT_ALLOWED` | 403 | Requested delivery mode is not permitted |
| `SESSION_EXPIRED` | 401 | Broker session has expired |
| `SESSION_REVOKED` | 401 | Broker session was revoked |
| `CONNECTOR_ERROR` | 500/502 | External vault connector failure |
| `CONNECTOR_NOT_FOUND` | 500 | Connector not found or not configured |
| `POLICY_NOT_FOUND` | 404 | Policy does not exist |
| `APPROVAL_NOT_FOUND` | 404 | Approval does not exist |
| `SESSION_NOT_FOUND` | 404 | Session does not exist |

---

## Health Check

```
GET /health
```

Response: `{ "status": "ok" }`

---

## Rate Limiting

| Path pattern | Limit |
|-------------|-------|
| `/api/auth/*` | 60 requests per 60 seconds |
| `/v1/*` | 100 requests per 60 seconds |

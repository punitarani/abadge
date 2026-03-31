# API Reference

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

All `/v1/*` management routes require a valid session cookie.

### Agent auth

Agent-facing routes accept a Bearer token in the `Authorization` header:

```
Authorization: Bearer abd_...   (API key)
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
| `name` | string (1-128) | yes | Display name |
| `type` | enum | yes | api_key, login, token, json_blob, oauth_client, service_account_json, cookie_session, pii, other |
| `value` | string (1-65536) | conditional | Secret value (encrypted at rest). Required when sourceType is "native". |
| `metadata` | Record<string, string> | no | Arbitrary key-value pairs |
| `ownerScope` | enum | no | user, org, system (default: user) |
| `environment` | enum | no | dev, staging, prod |
| `service` | string (max 128) | no | e.g., "github", "aws" |
| `provider` | string (max 128) | no | e.g., "cloud", "saas" |
| `project` | string (max 128) | no | Project identifier |
| `tags` | string[] (max 20) | no | Searchable tags |
| `sensitivity` | enum | no | low, medium, high, critical (default: medium) |
| `allowedDeliveryModes` | DeliveryMode[] | no | Restrict how this credential can be consumed |
| `allowedDestinations` | string[] (max 50) | no | Restrict where this credential can be sent |
| `sourceType` | enum | no | native (default) or external |
| `connectorId` | string | conditional | Required when sourceType is "external" |
| `externalRef` | ExternalRef | no | Reference to secret in external vault (see below) |
| `orgId` | string | no | Organization ID for team-owned credentials |

**ExternalRef fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Secret name in external vault |
| `path` | string | Secret path in external vault |
| `version` | string | Secret version |

When `sourceType` is "native", `value` is required (encrypted at rest). When `sourceType` is "external", `connectorId` is required and the value is fetched from the external vault at access time.

Response: `{ credential: { id, name } }` (201)

### Update credential

```
PUT /v1/credentials/:id
```

Same fields as create, all optional. If `value` is provided, it is re-encrypted.

### Delete credential

```
DELETE /v1/credentials/:id
```

---

## Agents

All routes require user session auth.

### List agents

```
GET /v1/agents
```

### Register agent

```
POST /v1/agents
```

| Field | Type | Required |
|-------|------|----------|
| `name` | string (1-64) | yes |
| `description` | string (max 256) | no |

Response: `{ agent: { id, name, prefix }, apiKey: "abd_..." }` (201)

The API key is shown **once**. Only the hash is stored.

### Update agent

```
PATCH /v1/agents/:id
```

| Field | Type |
|-------|------|
| `enabled` | boolean |
| `name` | string |
| `description` | string |

### Delete agent

```
DELETE /v1/agents/:id
```

---

## Permissions

All routes require user session auth.

### List permissions for credential

```
GET /v1/permissions/credential/:credentialId
```

### Grant permission

```
POST /v1/permissions/grant
```

| Field | Type | Required |
|-------|------|----------|
| `agentId` | string | yes |
| `credentialId` | uuid | yes |
| `policyId` | uuid | no |
| `allowedDeliveryModes` | DeliveryMode[] | no |
| `expiresAt` | ISO date | no |

### Revoke permission

```
POST /v1/permissions/revoke
```

| Field | Type | Required |
|-------|------|----------|
| `agentId` | string | yes |
| `credentialId` | uuid | yes |

---

## Policies

All routes require user session auth.

### List policies

```
GET /v1/policies
```

### Get policy

```
GET /v1/policies/:id
```

### Create policy

```
POST /v1/policies
```

| Field | Type | Required |
|-------|------|----------|
| `name` | string (1-128) | yes |
| `credentialId` | uuid | no (global if omitted) |
| `rules` | PolicyRule[] | yes |

**PolicyRule types:**

```jsonc
// Restrict delivery modes
{ "type": "delivery_mode", "deliveryModes": ["env_inject", "file_mount"] }

// Restrict environments
{ "type": "environment", "environments": ["prod"] }

// Require approval above threshold
{ "type": "sensitivity", "requiresApproval": true, "sensitivity": "high" }

// Restrict destinations
{ "type": "destination", "destinations": ["*.internal.com"], "blockedDestinations": ["*.public.com"] }

// Limit session TTL
{ "type": "ttl", "maxTtlSeconds": 3600 }
```

### Update policy

```
PUT /v1/policies/:id
```

| Field | Type |
|-------|------|
| `name` | string |
| `rules` | PolicyRule[] |
| `enabled` | boolean |

### Delete policy

```
DELETE /v1/policies/:id
```

---

## Approvals

All routes require user session auth. Only the credential owner can approve/deny.

### List approvals

```
GET /v1/approvals?status=pending
```

### Get approval

```
GET /v1/approvals/:id
```

### Approve

```
POST /v1/approvals/:id/approve
```

| Field | Type |
|-------|------|
| `reason` | string (max 512, optional) |

### Deny

```
POST /v1/approvals/:id/deny
```

| Field | Type |
|-------|------|
| `reason` | string (max 512, optional) |

---

## Connectors

All routes require user session auth. Connector configs are encrypted at rest.

### List connectors

```
GET /v1/connectors
```

### Get connector

```
GET /v1/connectors/:id
```

### Create connector

```
POST /v1/connectors
```

| Field | Type | Required |
|-------|------|----------|
| `name` | string (1-128) | yes |
| `type` | enum | yes (native, onepassword, aws_secrets_manager, bitwarden, infisical, doppler, gcloud_secret_manager, hashicorp_vault) |
| `config` | Record<string, string> | no (encrypted at rest) |

### Update connector

```
PUT /v1/connectors/:id
```

### Delete connector

```
DELETE /v1/connectors/:id
```

### Test connector

```
POST /v1/connectors/:id/test
```

Response: `{ success: boolean, error?: string }`

---

## Auto-Grants

All routes require user session auth. Auto-grants define rules that automatically grant permissions to an agent for any credential matching the specified criteria.

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
| `matchTags` | string[] (max 20) | no | Match credentials with ALL of these tags |
| `matchType` | enum | no | Match credentials of this type |
| `matchService` | string (max 128) | no | Match credentials for this service |
| `matchSensitivity` | enum | no | Match credentials at this sensitivity level |
| `policyId` | uuid | no | Attach this policy to auto-granted permissions |
| `allowedDeliveryModes` | DeliveryMode[] | no | Restrict delivery modes for auto-granted permissions |
| `expiresAt` | ISO date | no | Expiration for auto-granted permissions |

Matching is conjunctive: a credential must match ALL non-null criteria. For `matchTags`, the credential must have all specified tags (subset check).

Response: `{ autoGrant: AutoGrant }` (201)

### Update auto-grant

```
PUT /v1/auto-grants/:id
```

Same fields as create (except `agentId`), all optional. Set a field to `null` to clear it.

### Delete auto-grant

```
DELETE /v1/auto-grants/:id
```

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

| Field | Type | Required |
|-------|------|----------|
| `name` | string (1-128) | yes |
| `description` | string (max 512) | no |

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

| Field | Type |
|-------|------|
| `name` | string (1-128) |
| `description` | string (max 512, nullable) |

### Delete agent group

```
DELETE /v1/agent-groups/:id
```

Deleting a group cascades to remove all member associations.

### Add member to group

```
POST /v1/agent-groups/:id/members
```

| Field | Type | Required |
|-------|------|----------|
| `agentId` | string | yes |

Response: `{ member: AgentGroupMember }` (201)

Returns 409 if the agent is already a member.

### Remove member from group

```
DELETE /v1/agent-groups/:id/members/:agentId
```

---

## Broker Sessions

Routes require agent auth (API key Bearer token).

### Create session

```
POST /v1/sessions
```

| Field | Type | Required |
|-------|------|----------|
| `agentId` | string | yes |
| `scopes` | string[] | no (credential IDs to restrict access) |
| `allowedDeliveryModes` | DeliveryMode[] | no |
| `ttlSeconds` | number (1-86400) | yes |

Response: `{ sessionId, token: "abs_...", expiresAt }` (201)

The token is shown **once**. Only the hash is stored.

### List sessions

```
GET /v1/sessions
```

### Get session

```
GET /v1/sessions/:id
```

### Revoke session

```
DELETE /v1/sessions/:id
```

---

## Credential Access (Agent-facing)

Requires agent auth (API key or broker session token).

### Access credential

```
POST /v1/credentials/access
```

| Field | Type | Required |
|-------|------|----------|
| `credentialName` | string | one of name or id required |
| `credentialId` | uuid | one of name or id required |
| `deliveryMode` | DeliveryMode | no (default: reveal) |
| `purpose` | string (max 512) | no |
| `destination` | string (max 256) | no |
| `environment` | enum | no |

**Responses:**

Success (reveal mode):
```json
{
  "credential": { "name": "...", "type": "...", "metadata": {} },
  "deliveryMode": "reveal",
  "value": "decrypted_plaintext",
  "approved": true
}
```

Success (non-reveal mode — value not included):
```json
{
  "credential": { "name": "...", "type": "...", "metadata": {} },
  "deliveryMode": "env_inject",
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
{ "error": "Access denied", "code": "ACCESS_DENIED" }
{ "error": "Delivery mode not allowed", "code": "DELIVERY_MODE_NOT_ALLOWED" }
```

---

## Audit Log

Requires user session auth.

### Query audit log

```
GET /v1/audit?limit=50&offset=0
```

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | number (max 200) | Results per page |
| `offset` | number | Pagination offset |
| `outcome` | enum | allowed, denied, pending_approval, expired |
| `deliveryMode` | DeliveryMode | Filter by delivery mode |
| `principalType` | enum | human, app, agent, workload |
| `environment` | enum | dev, staging, prod |
| `agentId` | string | Filter by agent |
| `startDate` | ISO date | Start of date range |
| `endDate` | ISO date | End of date range |

---

## Delivery Modes

| Mode | Description | Value returned? |
|------|-------------|-----------------|
| `reveal` | Return decrypted plaintext | Yes |
| `env_inject` | Inject into subprocess environment | Yes (broker injects) |
| `file_mount` | Write to temp file (0600 perms) | Yes (broker writes) |
| `browser_fill` | Fill browser form fields | No (metadata only) |
| `operation_only` | Server-side operation only | No |

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
| `DELIVERY_MODE_NOT_ALLOWED` | 403 | Requested delivery mode is not permitted |
| `SESSION_EXPIRED` | 401 | Broker session has expired |
| `SESSION_REVOKED` | 401 | Broker session was revoked |

---

## Health Check

```
GET /health
```

Response: `{ "status": "ok" }`

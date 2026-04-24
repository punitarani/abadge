# TypeScript SDK Specification

> Client library reference for `@abadge/sdk`.

## Overview

The SDK provides two typed TypeScript clients for interacting with the abadge API.

| Client | Auth | Purpose |
|--------|------|---------|
| `AbadgeUserClient` | Session token | Manage organizations, profiles, items, agents, permissions, audit |
| `AbadgeAgentClient` | Ed25519 keypair session (preferred) or legacy API key | Access secrets via `access.*` methods |

---

## Installation

```bash
npm install @abadge/sdk
# or
bun add @abadge/sdk
```

---

## `AbadgeUserClient`

Session-token authenticated client for operator commands.

### Construction

```typescript
import { AbadgeUserClient } from "@abadge/sdk";

const client = new AbadgeUserClient({
  apiUrl: "https://api.abadge.dev",
  token: sessionToken,
});
```

### Organizations

```typescript
client.createOrganization({ name, slug? })
client.listOrganizations()
client.getOrganization(orgId)
client.updateOrganization(orgId, { name, slug })
client.deleteOrganization(orgId)
client.listMembers(orgId)
client.inviteMember(orgId, email, role)
client.removeMember(orgId, userId)
client.updateMemberRole(orgId, userId, role)
```

### Profiles

```typescript
client.createProfile(orgId, { name, description?, storageMode? })
client.listProfiles(orgId)
client.getProfile(profileId)
client.bootstrapProfile(profileId, { wrappedRootKey, kdfSalt, kdfParams })
client.changeProfilePassword(profileId, { wrappedRootKey, kdfSalt, kdfParams })
client.setupProfileRecovery(profileId, { recoveryWrappedRootKey })
client.rotateProfileKey(profileId, { wrappedRootKey, recoveryWrappedRootKey?, rekeyedItems })
client.deleteProfile(profileId)
```

### Items

```typescript
// Create (zero_knowledge)
client.createItem({
  profileId: string;
  storageMode: "zero_knowledge";
  label: string;
  kind: ItemKind;
  tags?: string[];
  encryptedItemKey: string;
  ciphertext: string;
})

// Create (server_managed)
client.createItem({
  profileId: string;
  storageMode: "server_managed";
  label: string;
  kind: ItemKind;
  tags?: string[];
  payload: ItemPayload;
})

client.listItems(profileId?)
client.getItem(itemId)
client.updateItem(itemId, data)   // optimistic concurrency via contentVersion
client.deleteItem(itemId)

// Owner reveal — returns { payload: ItemPayload } for the requested field
client.ownerRevealItem(itemId, field?)
```

### Agents

```typescript
client.createAgent({
  organizationId: string;
  name: string;
  kind: AgentKind;
  description?: string;
  authMethod?: "public_key_session" | "legacy_api_key";  // default: public_key_session
  publicKey?: string;
  issueBootstrapToken?: boolean;
})

client.listAgents()
client.getAgent(agentId)
client.rotateAgent(agentId)
client.revokeAgent(agentId)

// Issue a bootstrap token for an existing agent
client.issueBootstrapToken(agentId)
```

### Permissions

```typescript
client.createPermission({
  agentId: string;
  itemId: string;
  capability: Capability;
  expiresAt?: string;  // ISO 8601
})

client.listPermissions({ agentId?, itemId? })
client.revokePermission(permissionId)
```

### Audit

```typescript
client.listAuditEntries({
  orgId?: string;
  profileId?: string;
  agentId?: string;
  itemId?: string;
  surface?: string;
  field?: string;
  eventType?: AuditEventType;
  result?: AuditResult;
  cursor?: string;
  limit?: number;  // 1-100, default 50
})
```

---

## `AbadgeAgentClient`

Agent-authenticated client for accessing secrets. Supports Ed25519 keypair sessions (preferred) or legacy API keys.

### Construction

```typescript
import { AbadgeAgentClient } from "@abadge/sdk";

// Keypair auth (preferred)
const agent = new AbadgeAgentClient({
  apiUrl: "https://api.abadge.dev",
  agentId: "agent_...",
  privateKey: ed25519PrivateKey,
});

// Legacy API key auth
const agent = new AbadgeAgentClient({
  apiUrl: "https://api.abadge.dev",
  apiKey: "abl_...",
});
```

### Lifecycle

```typescript
// Start session exchange and background refresh loop
await agent.connect();

// ... use the client ...

// Stop the refresh loop
agent.disconnect();
```

`connect()` performs the Ed25519 challenge/exchange and starts a background refresh that re-exchanges the session when less than 2 minutes of TTL remain. Legacy API key clients do not need `connect()`.

### Enrollment

```typescript
// Enroll an agent with a bootstrap token and public key
agent.enroll(bootstrapToken: string, publicKey: string)
```

### Access Methods

These methods enforce the capability matrix and log every attempt.

#### `agent.accessCiphertext(itemId)`

Read the encrypted blob of a ZK item for local decryption.

**Requires:** `read_ciphertext` permission. Local agent only. ZK item only.

```typescript
const { encryptedItemKey, ciphertext, contentNonce, cryptoVersion } =
  await agent.accessCiphertext(itemId);
```

#### `agent.accessReveal(itemId, field?)`

Decrypt and return a field value from a server-managed item. Returns `{ payload: ItemPayload }`.

**Requires:** `reveal_plaintext` permission. Server-managed item only.

```typescript
const { payload } = await agent.accessReveal(itemId);

// With a specific field
const { payload: fieldPayload } = await agent.accessReveal(itemId, "password");
```

#### `agent.accessMount(itemId, mountType, field?)`

Request item data for local injection (env var or temp file).

**Requires:** `mount_env` or `mount_file` permission. Local agent only.

```typescript
const data = await agent.accessMount(itemId, "env", "password");
```

### Other Methods

```typescript
agent.getSelf()                        // Get this agent's own record
agent.listItems(profileId)             // Metadata only
agent.listAuditEntries(orgId, filters?) // Structured audit listing
```

---

## Return Types

`accessReveal` returns `{ payload: ItemPayload }` where `ItemPayload` contains the decrypted item fields. The payload is a plain object, not wrapped in an opaque type.

---

## Field Delivery

The `field` parameter on `access.reveal` and `access.mount` selects a specific named field from a multi-field item. Field resolution is handled by `resolveFieldValue` from `@abadge/core/secret-delivery`, re-exported from the SDK for convenience.

Behavior:
- If `field` is omitted and the item has exactly one field, that field is returned
- If `field` is omitted and the item has multiple fields, the server returns `MULTI_FIELD_ITEM` with a list of available fields
- If `field` is specified but does not exist, the server returns `FIELD_NOT_FOUND` with available fields

```typescript
import { resolveFieldValue } from "@abadge/sdk";
```

---

## Error Handling

All API errors are thrown as `AbadgeApiError`.

```typescript
import { AbadgeApiError } from "@abadge/sdk";

class AbadgeApiError extends Error {
  statusCode: number;                     // HTTP status code
  code: string;                           // Machine-readable code (e.g., "PERMISSION_DENIED")
  message: string;                        // Human-readable description
  hint: string;                           // Actionable next step
  meta?: Record<string, unknown>;         // Structured context for clients

  static fromResponse(res: Response, fallback: string): Promise<AbadgeApiError>;
  static fromUnknown(error: unknown, fallback: string): AbadgeApiError;
}
```

### Usage

```typescript
import { AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";

try {
  const { payload } = await agent.accessReveal(itemId, "password");
} catch (err) {
  if (err instanceof AbadgeApiError) {
    console.error(`${err.code}: ${err.message}`);
    console.error(`Hint: ${err.hint}`);

    switch (err.code) {
      case "PERMISSION_DENIED":
        // No matching permission for this capability
        break;
      case "FIELD_NOT_FOUND":
        // Named field not present in item; err.meta has available fields
        break;
      case "MULTI_FIELD_ITEM":
        // Item has multiple fields; specify --field
        break;
    }
  }
  throw err;
}
```

---

## Type Exports

The SDK re-exports all domain types from `@abadge/core`:

```typescript
// Enums / unions
export type ItemKind = "login" | "api_key" | "token" | "json" | "certificate" | "ssh_key" | "opaque";
export type StorageMode = "zero_knowledge" | "server_managed";
export type AgentKind = "local_cli" | "local_mcp" | "remote";
export type AgentLocality = "local" | "remote";
export type Capability = "read_ciphertext" | "reveal_plaintext" | "mount_env" | "mount_file";
export type AuditEventType = "profile.create" | "profile.rotate" | "item.export" | ... ;
export type AuditResult = "allowed" | "denied" | "expired" | "revoked" | "cascade";

// Helpers
export { resolveFieldValue } from "@abadge/core/secret-delivery";

// Error
export { AbadgeApiError } from "./error";
```

---

## Usage Examples

### User: Create an item and grant access

```typescript
import { AbadgeUserClient } from "@abadge/sdk";

const client = new AbadgeUserClient({
  apiUrl: "https://api.abadge.dev",
  token: userSessionToken,
});

// Create a server-managed item
const { id: itemId } = await client.createItem({
  profileId: "prof_...",
  storageMode: "server_managed",
  label: "GitHub Deploy Token",
  kind: "token",
  tags: ["ci", "github"],
  payload: {
    v: 1,
    label: "GitHub Deploy Token",
    kind: "token",
    tags: ["ci", "github"],
    fields: { token: "ghp_xxxxxxxxxxxx" },
  },
});

// Register an agent (defaults to public_key_session)
const { agent, bootstrapToken } = await client.createAgent({
  organizationId: "org_...",
  name: "github-actions-deploy",
  kind: "remote",
  issueBootstrapToken: true,
});

// Grant reveal_plaintext capability
await client.createPermission({
  agentId: agent.id,
  itemId,
  capability: "reveal_plaintext",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});
```

### Agent: Access a secret with keypair auth

```typescript
import { AbadgeAgentClient } from "@abadge/sdk";

const agent = new AbadgeAgentClient({
  apiUrl: "https://api.abadge.dev",
  agentId: "agent_...",
  privateKey: ed25519PrivateKey,
});

await agent.connect();

const { payload } = await agent.accessReveal(itemId);
const token = payload.fields.token;

// Use the token...

agent.disconnect();
```

### Audit: Review access history

```typescript
const { entries, nextCursor } = await client.listAuditEntries({
  itemId,
  limit: 10,
});

for (const entry of entries) {
  console.log(`${entry.occurredAt}: ${entry.eventType} → ${entry.result}`);
}
```

# TypeScript SDK Specification

> Client library reference for `@abadge/sdk`.

## Overview

The SDK provides two typed TypeScript clients for interacting with the abadge API.

| Client | Auth | Purpose |
|--------|------|---------|
| `AbadgeUserClient` | Better Auth session token or personal API key (`abu_`) | Manage organizations, profiles, items, agents, permissions, audit |
| `AbadgeAgentClient` | Ed25519 keypair session (`abs_`) | Access secrets via `access.*` methods |

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
  sessionToken: sessionToken,
});
```

### Organizations

```typescript
client.orgs.create({ name, slug? })
client.orgs.list()
client.orgs.get(orgId)
client.orgs.update(orgId, { name })
client.orgs.delete(orgId)
client.listMembers(orgId)
client.inviteMember(orgId, { role })
client.removeMember(orgId, userId)
client.updateMemberRole(orgId, userId, role)
```

### Profiles

```typescript
client.profiles.create({ orgId, name, description?, storageMode? })
client.profiles.list(orgId)
client.profiles.get(profileId)
client.bootstrapProfile(profileId, { wrappedRootKey, kdfSalt, kdfParams })
client.changeProfilePassword(profileId, { wrappedRootKey, kdfSalt, kdfParams })
client.setupProfileRecovery(profileId, { recoveryWrappedRootKey })
client.rotateProfileKey(profileId, { wrappedRootKey, recoveryWrappedRootKey?, rekeyedItems })
client.profiles.delete(profileId)
```

### Items

```typescript
// Create (zero_knowledge)
client.items.create({
  profileId: string;
  storageMode: "zero_knowledge";
  label: string;
  kind: ItemKind;
  tags?: string[];
  encryptedItemKey: string;
  ciphertext: string;
})

// Create (server_managed)
client.items.create({
  profileId: string;
  storageMode: "server_managed";
  label: string;
  kind: ItemKind;
  tags?: string[];
  payload: ItemPayload;
})

client.items.list()
client.items.get(itemId)
client.items.update(itemId, data)   // optimistic concurrency via contentVersion
client.items.delete(itemId)

// Owner reveal — returns { payload: ItemPayload }
client.ownerReveal(itemId)
```

### Agents

```typescript
client.agents.create({
  name: string;
  kind: AgentKind;
  description?: string;
  authMethod?: "public_key_session";  // only value; default
  publicKey?: string;
  issueBootstrapToken?: boolean;
})

client.agents.list()
client.agents.get(agentId)
client.agents.delete(agentId)  // revoke agent

// Issue a bootstrap token for an existing agent
client.issueBootstrapToken(agentId)
```

### Permissions

```typescript
client.permissions.create({
  agentId: string;
  itemId: string;
  capabilities: Capability[];
  expiresAt?: string;  // ISO 8601
})

client.permissions.list({ agentId?, itemId? })
client.permissions.delete(permissionId)
```

### Audit

```typescript
client.audit.list({
  agentId?: string;
  itemId?: string;
  eventType?: AuditEventType;
  result?: AuditResult;
  cursor?: string;
  limit?: number;  // 1-100, default 50
})
```

---

## `AbadgeAgentClient`

Agent-authenticated client for accessing secrets. Uses Ed25519 keypair sessions.

### Construction

```typescript
import { AbadgeAgentClient } from "@abadge/sdk";

// Keypair auth
const agent = new AbadgeAgentClient({
  apiUrl: "https://api.abadge.dev",
  agentId: "agent_...",
  privateKey: ed25519PrivateKey,
});

// Pre-exchanged session token
const agent = new AbadgeAgentClient({
  apiUrl: "https://api.abadge.dev",
  apiKey: "abs_...",   // a session token minted elsewhere
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

`connect()` performs the Ed25519 challenge/exchange and starts a background refresh that re-exchanges the session when less than 2 minutes of TTL remain. A client constructed with a pre-exchanged `abs_...` token does not need `connect()`.

### Enrollment

```typescript
// Enroll an agent with a bootstrap token and public key
agent.enroll(bootstrapToken: string, publicKey: string)
```

### Access Methods

These methods enforce the capability matrix and log every attempt.

#### `agent.access.read(itemId, opts?)`

Read an item. For server-managed items returns the decrypted payload. For ZK items returns the encrypted envelope for local daemon decryption.

**Requires:** `reveal_plaintext` (server-managed) or `read_ciphertext` (ZK, local only).

Returns a discriminated union on `storageMode`:

```typescript
const result = await agent.access.read(itemId);
if (result.storageMode === "server_managed") {
  const value = result.payload.fields.password;
} else {
  // ZK envelope: decrypt client-side via daemon
  const { encryptedItemKey, ciphertext, cryptoVersion } = result;
}

// With a specific field (server-managed only)
const result = await agent.access.read(itemId, { field: "password" });
```

#### `agent.access.use(target, opts)`

Mint a short-lived mount handle for local injection (env var or temp file). The daemon redeems the handle for the actual material.

**Requires:** `mount_env` or `mount_file` permission. Local agent only.

```typescript
// Single item
const { mountId } = await agent.access.use(
  { itemId: "item_..." },
  { delivery: "env", field: "password" }
);

// All items in a profile
const handles = await agent.access.use(
  { profileId: "prof_..." },
  { delivery: "env" }
);
```

### Other Methods

```typescript
agent.getCurrentAgent()                // Get this agent's own record
agent.listItems()                      // Metadata only
agent.getAudit(filters?)               // Structured audit listing
```

---

## Return Types

`access.read` returns a discriminated union on `storageMode`. For `"server_managed"` items the response is `{ storageMode: "server_managed", payload: ItemPayload }`. For `"zero_knowledge"` items the response is the encrypted envelope `{ storageMode: "zero_knowledge", encryptedItemKey, ciphertext, cryptoVersion, itemId, profileId, contentVersion }` for local daemon decryption.

---

## Field Delivery

The `field` option on `access.read` and `access.use` selects a specific named field from a multi-field item. Field resolution is handled by `resolveFieldValue` from `@abadge/core/secret-delivery`, re-exported from the SDK for convenience.

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
  const result = await agent.access.read(itemId, { field: "password" });
  if (result.storageMode !== "server_managed") throw new Error("Expected server_managed item");
  const value = result.payload.fields.password;
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
        // Item has multiple fields; specify field option
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
  sessionToken: userSessionToken,
});

// Create a server-managed item
const { id: itemId } = await client.items.create({
  profileId: "prof_...",
  storageMode: "server_managed",
  payload: {
    v: 1,
    label: "GitHub Deploy Token",
    kind: "token",
    tags: ["ci", "github"],
    fields: { token: "ghp_xxxxxxxxxxxx" },
  },
});

// Register an agent (defaults to public_key_session)
const { agent, bootstrapToken } = await client.agents.create({
  name: "github-actions-deploy",
  kind: "remote",
  issueBootstrapToken: true,
});

// Grant reveal_plaintext capability
await client.permissions.create({
  agentId: agent.id,
  itemId,
  capabilities: ["reveal_plaintext"],
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

const result = await agent.access.read(itemId);
if (result.storageMode !== "server_managed") throw new Error("Expected server_managed item");
const token = result.payload.fields.token;

// Use the token...

agent.disconnect();
```

### Audit: Review access history

```typescript
const { entries, nextCursor } = await client.audit.list({
  itemId,
  limit: 10,
});

for (const entry of entries) {
  console.log(`${entry.occurredAt}: ${entry.eventType} → ${entry.result}`);
}
```

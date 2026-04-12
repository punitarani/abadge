# TypeScript SDK Specification

> Client library reference for `@abadge/sdk`.
> The SDK is the programmatic interface to the abadge control plane.

## Overview

The SDK provides a typed TypeScript client that wraps the abadge API. It is used by the CLI, can be used by custom integrations, and is published as `@abadge/sdk` on npm.

The SDK has two personas:

| Persona | Auth | Can do |
|---------|------|--------|
| **User client** | Session token | Manage vault, items, agents, permissions, audit |
| **Agent client** | API key (`abl_` / `abg_`) | Access secrets via `access.*` methods |

Both use the same `AbadgeClient` class — the server determines available operations based on the token type.

---

## Installation

```bash
npm install @abadge/sdk
# or
bun add @abadge/sdk
```

---

## Client Construction

```typescript
import { AbadgeClient } from "@abadge/sdk";

const client = new AbadgeClient({
  apiUrl: "https://api.abadge.dev",
  token: "session_token_or_api_key",
});
```

### Configuration

```typescript
interface AbadgeClientConfig {
  apiUrl: string;   // API endpoint URL (no trailing slash)
  token: string;    // Session token or agent API key
}
```

---

## Methods

### Vault

#### `client.bootstrapVault(data)`

Initialize the user's vault. Called once after account creation.

```typescript
async bootstrapVault(data: {
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: {
    algorithm: "argon2id";
    memory: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
  };
}): Promise<{ id: string }>
```

**Errors:** `VAULT_ALREADY_EXISTS`

#### `client.getVault()`

Retrieve vault metadata.

```typescript
async getVault(): Promise<{
  vault: {
    id: string;
    userId: string;
    wrappedRootKey: string;
    kdfSalt: string;
    kdfParams: KdfParams;
    recoveryWrappedRootKey: string | null;
    keyVersion: number;
    createdAt: string;
    updatedAt: string;
  };
}>
```

**Errors:** `VAULT_NOT_FOUND`

#### `client.changePassword(data)`

Re-wrap root key with new password.

```typescript
async changePassword(data: {
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
}): Promise<{ ok: boolean }>
```

**Errors:** `VAULT_NOT_FOUND`

#### `client.setupRecovery(data)`

Set recovery key.

```typescript
async setupRecovery(data: {
  recoveryWrappedRootKey: string;
}): Promise<{ ok: boolean }>
```

**Errors:** `VAULT_NOT_FOUND`

#### `client.rotateKey(data)`

Rotate root key. Requires re-keying all ZK items atomically.

```typescript
async rotateKey(data: {
  wrappedRootKey: string;
  recoveryWrappedRootKey?: string;
  rekeyedItems: Record<string, string>; // itemId → newEncryptedItemKey
}): Promise<{ ok: boolean; keyVersion: number }>
```

**Errors:** `VAULT_NOT_FOUND`

---

### Items

#### `client.createItem(data)`

Create a new encrypted item.

```typescript
// Zero-knowledge
async createItem(data: {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
}): Promise<{ id: string }>

// Server-managed
async createItem(data: {
  storageMode: "server_managed";
  payload: {
    v: number;
    label: string;
    kind: ItemKind;
    tags: string[];
    notes?: string;
    fields: Record<string, unknown>;
  };
}): Promise<{ id: string }>
```

#### `client.listItems()`

List all items (metadata only).

```typescript
async listItems(): Promise<{
  items: Array<{
    id: string;
    storageMode: "zero_knowledge" | "server_managed";
    cryptoVersion: number;
    contentVersion: number;
    createdAt: string;
    updatedAt: string;
  }>;
}>
```

#### `client.getItem(id)`

Retrieve a single item.

```typescript
async getItem(id: string): Promise<{
  item: ItemDetail; // ZK includes encryptedItemKey + ciphertext; server-managed includes metadata only
}>
```

**Errors:** `ITEM_NOT_FOUND`

#### `client.updateItem(id, data)`

Update an item with optimistic concurrency.

```typescript
// Zero-knowledge
async updateItem(id: string, data: {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
  contentVersion: number;
}): Promise<{ ok: boolean; contentVersion: number }>

// Server-managed
async updateItem(id: string, data: {
  storageMode: "server_managed";
  payload: ItemPayload;
  contentVersion: number;
}): Promise<{ ok: boolean; contentVersion: number }>
```

**Errors:** `ITEM_NOT_FOUND`, `STALE_VERSION`

#### `client.deleteItem(id)`

Soft-delete an item.

```typescript
async deleteItem(id: string): Promise<{ ok: boolean }>
```

**Errors:** `ITEM_NOT_FOUND`

---

### Agents

#### `client.createAgent(data)`

Register a new agent. Returns the API key exactly once.

```typescript
async createAgent(data: {
  kind: "device" | "local_cli" | "local_mcp" | "remote_agent";
  name: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  agent: Agent;
  apiKey: string; // One-time display
}>
```

#### `client.listAgents()`

List all agents.

```typescript
async listAgents(): Promise<{
  agents: Array<{
    id: string;
    userId: string;
    kind: AgentKind;
    locality: "local" | "remote";
    name: string;
    keyPrefix: string | null;
    enabled: boolean;
    revokedAt: string | null;
    lastUsedAt: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}>
```

#### `client.rotateAgent(id)`

Rotate an agent's API key.

```typescript
async rotateAgent(id: string): Promise<{
  apiKey: string;    // New key, shown once
  keyPrefix: string;
}>
```

**Errors:** `AGENT_NOT_FOUND`

#### `client.revokeAgent(id)`

Revoke an agent.

```typescript
async revokeAgent(id: string): Promise<{ ok: boolean }>
```

**Errors:** `AGENT_NOT_FOUND`

---

### Permissions

#### `client.createPermission(data)`

Grant a capability to an agent for an item.

```typescript
async createPermission(data: {
  agentId: string;
  itemId: string;
  capability: Capability;
  expiresAt?: string; // ISO 8601
}): Promise<{
  permission: {
    id: string;
    agentId: string;
    itemId: string;
    capability: Capability;
    expiresAt: string | null;
    createdBy: string;
    createdAt: string;
  };
}>
```

**Errors:** `AGENT_NOT_FOUND`, `ITEM_NOT_FOUND`, `INVALID_CAPABILITY`

#### `client.listPermissions(filters?)`

List permissions, optionally filtered.

```typescript
async listPermissions(filters?: {
  agentId?: string;
  itemId?: string;
}): Promise<{
  permissions: Array<Permission>;
}>
```

#### `client.revokePermission(id)`

Revoke a permission.

```typescript
async revokePermission(id: string): Promise<{ ok: boolean }>
```

**Errors:** `PERMISSION_NOT_FOUND`

---

### Access (Agent Methods)

These methods are used by agents (authenticated with API keys) to access secrets. They enforce the capability access matrix and log every attempt.

#### `client.accessCiphertext(itemId)`

Read the encrypted blob of a ZK item for local decryption.

```typescript
async accessCiphertext(itemId: string): Promise<{
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}>
```

**Requires:** `read_ciphertext` permission. Local agent only. ZK item only.
**Errors:** `FORBIDDEN`, `PERMISSION_DENIED`, `PERMISSION_EXPIRED`, `ITEM_NOT_FOUND`

#### `client.accessReveal(itemId)`

Decrypt and return the plaintext of a server-managed item.

```typescript
async accessReveal(itemId: string): Promise<{
  payload: {
    v: number;
    label: string;
    kind: ItemKind;
    tags: string[];
    notes?: string;
    fields: Record<string, unknown>;
  };
}>
```

**Requires:** `reveal_plaintext` permission. Server-managed item only.
**Errors:** `BAD_REQUEST`, `PERMISSION_DENIED`, `PERMISSION_EXPIRED`, `ITEM_NOT_FOUND`

#### `client.accessMount(itemId, mountType)`

Request item data for local injection.

```typescript
async accessMount(
  itemId: string,
  mountType: "env" | "file"
): Promise<
  | {
      storageMode: "zero_knowledge";
      encryptedItemKey: string;
      ciphertext: string;
      cryptoVersion: number;
    }
  | {
      storageMode: "server_managed";
      payload: ItemPayload;
    }
>
```

**Requires:** `mount_env` or `mount_file` permission. Local agent only.
**Errors:** `FORBIDDEN`, `PERMISSION_DENIED`, `PERMISSION_EXPIRED`, `ITEM_NOT_FOUND`

---

### Audit

#### `client.getAudit(filters?)`

Query the audit log.

```typescript
async getAudit(filters?: {
  eventType?: AuditEventType;
  result?: AuditResult;
  agentId?: string;
  itemId?: string;
  cursor?: string;
  limit?: number; // 1-100, default 50
}): Promise<{
  entries: Array<{
    id: number;
    userId: string;
    agentId: string | null;
    itemId: string | null;
    eventType: AuditEventType;
    result: AuditResult;
    deliveryMode: string | null;
    meta: Record<string, unknown>;
    ipAddress: string | null;
    occurredAt: string;
  }>;
  nextCursor: string | null;
}>
```

---

## Error Handling

All API errors are thrown as `AbadgeApiError`.

```typescript
class AbadgeApiError extends Error {
  statusCode: number;   // HTTP status code
  code: string;         // Error code (e.g., "VAULT_NOT_FOUND")
  message: string;      // Human-readable description

  static fromResponse(res: Response, fallback: string): Promise<AbadgeApiError>;
  static fromUnknown(error: unknown, fallback: string): AbadgeApiError;
}
```

### Error Handling Patterns

```typescript
import { AbadgeClient, AbadgeApiError } from "@abadge/sdk";

const client = new AbadgeClient({ apiUrl, token });

try {
  const { permission } = await client.createPermission({
    agentId: "...",
    itemId: "...",
    capability: "mount_env",
  });
} catch (err) {
  if (err instanceof AbadgeApiError) {
    switch (err.code) {
      case "AGENT_NOT_FOUND":
        console.error("Agent does not exist");
        break;
      case "ITEM_NOT_FOUND":
        console.error("Item does not exist");
        break;
      case "INVALID_CAPABILITY":
        console.error("This capability is not allowed for this agent/item combination");
        break;
      default:
        console.error(`API error: ${err.message}`);
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
export type AgentKind = "device" | "local_cli" | "local_mcp" | "remote_agent";
export type AgentLocality = "local" | "remote";
export type Capability = "read_ciphertext" | "reveal_plaintext" | "mount_env" | "mount_file" | "use_without_reveal";
export type AuditEventType = "profile.create" | "profile.rotate" | "item.export" | ... ;
export type AuditResult = "allowed" | "denied" | "expired" | "revoked";

// Entity types
export type Vault = { ... };
export type ItemSummary = { ... };
export type ItemDetail = { ... };
export type ItemPayload = { ... };
export type Agent = { ... };
export type AgentWithKey = { agent: Agent; apiKey: string };
export type Permission = { ... };
export type AuditEntry = { ... };

// Input types
export type CreateItemInput = { ... };
export type UpdateItemInput = { ... };
export type CreateAgentInput = { ... };
export type CreatePermissionInput = { ... };
export type AuditQuery = { ... };

// Result types
export type SuccessResult = { ok: boolean };
export type VaultResult = { vault: Vault };
export type ItemResult = { item: ItemDetail };
export type ItemListResult = { items: ItemSummary[] };
export type AgentResult = { agent: Agent };
export type AgentListResult = { agents: Agent[] };
export type PermissionResult = { permission: Permission };
export type PermissionListResult = { permissions: Permission[] };
export type AuditListResult = { entries: AuditEntry[]; nextCursor: string | null };

// Error
export { AbadgeApiError } from "./error";
```

---

## Usage Examples

### User: Create an item and grant access

```typescript
import { AbadgeClient } from "@abadge/sdk";

const client = new AbadgeClient({
  apiUrl: "https://api.abadge.dev",
  token: userSessionToken,
});

// Create a server-managed item
const { id: itemId } = await client.createItem({
  storageMode: "server_managed",
  payload: {
    v: 1,
    label: "GitHub Deploy Token",
    kind: "token",
    tags: ["ci", "github"],
    fields: { token: "ghp_xxxxxxxxxxxx" },
  },
});

// Register an agent
const { agent, apiKey } = await client.createAgent({
  kind: "remote_agent",
  name: "github-actions-deploy",
});
// Store apiKey securely — it won't be shown again

// Grant reveal_plaintext capability
await client.createPermission({
  agentId: agent.id,
  itemId,
  capability: "reveal_plaintext",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
});
```

### Agent: Access a secret

```typescript
import { AbadgeClient } from "@abadge/sdk";

const agentClient = new AbadgeClient({
  apiUrl: "https://api.abadge.dev",
  token: "abg_xxxxxxxxxxxx", // Agent API key
});

// Reveal plaintext
const { payload } = await agentClient.accessReveal(itemId);
const token = payload.fields.token as string;

// Use the token...
```

### Audit: Review access history

```typescript
const { entries, nextCursor } = await client.getAudit({
  itemId,
  limit: 10,
});

for (const entry of entries) {
  console.log(`${entry.occurredAt}: ${entry.eventType} → ${entry.result}`);
}
```

---

## Design Decisions

### Why a single client class for both user and agent?

Simplicity. The same HTTP transport and error handling applies to both. The server determines what operations are available based on the token type. This avoids maintaining two client classes with overlapping code.

### Why throw errors instead of returning Result types?

The SDK targets TypeScript, where try/catch is the idiomatic error handling pattern. All errors are typed (`AbadgeApiError`) with machine-readable `code` fields, so callers can handle specific cases without string matching.

### Why re-export core types?

SDK consumers should not need to install `@abadge/core` separately. All types needed to interact with the API are re-exported from the SDK package. This keeps the dependency graph simple: install `@abadge/sdk`, get everything you need.

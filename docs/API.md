# API Reference

The canonical control-plane transport is tRPC over HTTP at `/trpc`. The shared transport package
in `packages/trpc` is the source of truth for:

* router types
* request context construction
* tRPC error formatting
* browser, node, and server callers

Better Auth remains mounted at `/api/auth/*`. Health remains mounted at `/health`.

Base URL: `https://your-api-domain` (local dev: `http://localhost:8787`)

## Transport

Use the shared clients instead of hand-rolling raw HTTP calls:

```ts
import { createNodeTrpcClient } from "@abadge/trpc/client";

const client = createNodeTrpcClient({
  baseUrl: "http://localhost:8787",
  token: process.env.ABADGE_TOKEN!,
});

const { items } = await client.items.list.query();
```

Notes:

* browser callers use cookies with `httpBatchLink`
* node and bun callers use Bearer auth headers
* timestamps are JSON-safe ISO strings at the boundary
* there is no REST compatibility shim

## Authentication

### Better Auth

Better Auth remains on `/api/auth/*`.

Common flows:

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
POST /api/auth/sign-out
GET  /api/auth/get-session
```

Dashboard callers use Better Auth cookies. Session-backed tRPC procedures also accept a raw Better
Auth session token in `Authorization: Bearer ...`, which is how the SDK, CLI, and daemon helpers
authenticate after email/password sign-in.

### Principal auth

Principal-facing procedures require a Bearer token:

```text
Authorization: Bearer abl_...   local principal
Authorization: Bearer abg_...   remote principal
```

Resolution order:

1. candidate lookup by stored `secretPrefix`
2. constant-time verification of candidate hashes
3. legacy Better Auth API-key verification fallback

## Procedure tiers

| Tier | Auth | Used by |
|------|------|---------|
| `publicProcedure` | none | No public application procedures currently |
| `sessionProcedure` | Better Auth session or verified user token | Dashboard, SDK, CLI, daemon helpers |
| `principalProcedure` | Principal Bearer token | Broker, MCP, remote agents |

## Session Procedures

### `vault.bootstrap`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `wrappedRootKey` | string | yes | Vault root key wrapped by the user password |
| `kdfSalt` | string | yes | Salt for password KDF |
| `kdfParams` | object | yes | Argon2id parameters |

Response: `{ id }`

### `vault.get`

Auth: `sessionProcedure`

Input: none

Response:

```ts
{
  vault: {
    id: string;
    wrappedRootKey: string;
    kdfSalt: string;
    kdfParams: {
      algorithm: "argon2id";
      memory: number;
      iterations: number;
      parallelism: number;
      hashLength: number;
    };
    recoveryWrappedRootKey: string | null;
    keyVersion: number;
    createdAt: string;
    updatedAt: string;
  };
}
```

### `vault.changePassword`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `wrappedRootKey` | string | yes | Vault root key wrapped with the new password |
| `kdfSalt` | string | yes | New KDF salt |
| `kdfParams` | object | yes | New Argon2id parameters |

Response: `{ ok: true }`

### `vault.setupRecovery`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `recoveryWrappedRootKey` | string | yes | Recovery-wrapped copy of the vault root key |

Response: `{ ok: true }`

### `vault.rotateKey`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `wrappedRootKey` | string | yes | Vault root key wrapped with rotated vault key material |
| `recoveryWrappedRootKey` | string | no | Replacement recovery-wrapped key |
| `rekeyedItems` | `Record<string, string>` | yes | Map of item id to replacement `encryptedItemKey` |

Response: `{ ok: true, keyVersion: number }`

### `items.create`

Auth: `sessionProcedure`

Zero-knowledge input:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `storageMode` | `"zero_knowledge"` | yes | Item stays client-encrypted |
| `encryptedItemKey` | string | yes | Wrapped per-item key |
| `ciphertext` | string | yes | Client-encrypted payload |

Server-managed input:

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `storageMode` | `"server_managed"` | yes | Item is encrypted by the API worker |
| `payload` | `ItemPayload` | yes | JSON-safe item payload |

Response: `{ id }`

### `items.list`

Auth: `sessionProcedure`

Input: none

Response: `{ items: ItemSummary[] }`

### `items.get`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Item identifier |

Response: `{ item: ItemDetail }`

Notes:

* zero-knowledge items return encrypted fields for client-side decryption
* server-managed items return metadata only, not plaintext

### `items.update`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Item identifier |
| `data` | `UpdateItemInput` | yes | Replacement item body |

`UpdateItemInput` requires `contentVersion` for optimistic concurrency.

Response: `{ ok: true, contentVersion: number }`

### `items.delete`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Item identifier |

Response: `{ ok: true }`

Deletion is soft-delete via `deletedAt`.

### `principals.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | enum | yes | `device`, `local_cli`, `local_mcp`, `remote_agent` |
| `name` | string | yes | Display name |
| `metadata` | object | no | Free-form metadata |

Response:

```ts
{
  principal: Principal;
  secret: string;
}
```

`secret` is shown once and is never retrievable again.

### `principals.list`

Auth: `sessionProcedure`

Input: none

Response: `{ principals: Principal[] }`

### `principals.get`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `principalId` | string | yes | Principal identifier |

Response: `{ principal: Principal }`

### `principals.rotate`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `principalId` | string | yes | Principal identifier |

Response: `{ secret: string, secretPrefix: string }`

### `principals.revoke`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `principalId` | string | yes | Principal identifier |

Response: `{ ok: true }`

### `grants.create`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `principalId` | string | yes | Principal receiving access |
| `itemId` | string | yes | Target item |
| `capability` | enum | yes | `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`, `use_without_reveal` |
| `expiresAt` | string | no | ISO timestamp for grant expiry |

Response: `{ grant: Grant }`

Current enforcement also rejects:

* remote principal + zero-knowledge item
* remote principal + capability other than `reveal_plaintext`

### `grants.list`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `principalId` | string | no | Restrict to one principal |
| `itemId` | string | no | Restrict to one item |

Response: `{ grants: Grant[] }`

### `grants.revoke`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `grantId` | string | yes | Grant identifier |

Response: `{ ok: true }`

### `audit.list`

Auth: `sessionProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `limit` | number | no | Maximum entries to return. Defaults to `50` |
| `cursor` | string | no | Cursor for backward pagination |
| `eventType` | string | no | Filter by audit event type |
| `result` | string | no | Filter by audit result |
| `principalId` | string | no | Filter by principal |
| `itemId` | string | no | Filter by item |

Response: `{ entries: AuditEntry[], nextCursor: string | null }`

## Principal Procedures

### `access.ciphertext`

Auth: `principalProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target zero-knowledge item |

Response:

```ts
{
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}
```

Restrictions:

* local principals only
* item must be zero-knowledge
* grant must include `read_ciphertext`

### `access.reveal`

Auth: `principalProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target server-managed item |

Response:

```ts
{
  payload: ItemPayload;
}
```

Restrictions:

* item must be server-managed
* grant must include `reveal_plaintext`

### `access.mount`

Auth: `principalProcedure`

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `mountType` | `"env" | "file"` | yes | Mount mode |

Response for zero-knowledge items:

```ts
{
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}
```

Response for server-managed items:

```ts
{
  storageMode: "server_managed";
  payload: ItemPayload;
}
```

Restrictions:

* local principals only
* grants must include `mount_env` or `mount_file`
* remote principals cannot mount

## Errors

tRPC errors are normalized into stable domain codes and messages. Client callers should read the
error `data.code` and `message`, not rely on raw transport details.

Common codes:

* `UNAUTHORIZED`
* `FORBIDDEN`
* `NOT_FOUND`
* `CONFLICT`
* `BAD_REQUEST`
* `INVALID_CAPABILITY`
* `GRANT_DENIED`
* `STALE_VERSION`
* `VAULT_NOT_FOUND`

## Public HTTP Routes

| Path | Method | Auth | Purpose |
|------|--------|------|---------|
| `/trpc/*` | tRPC transport | session or principal depending on procedure | Canonical control plane |
| `/api/auth/*` | Better Auth routes | varies by route | Sign in, sign out, sessions |
| `/health` | GET | none | Worker health check |

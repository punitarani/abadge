# Capability Matrix

## Agent Types

| Kind | Locality | Auth Method | Can Decrypt ZK | Description |
|------|----------|-------------|----------------|-------------|
| `local_cli` | local | Ed25519 keypair session (default) or legacy API key | Yes (via daemon) | CLI installation |
| `local_mcp` | local | Ed25519 keypair session | Yes (via daemon) | Local MCP server |
| `remote` | remote | Ed25519 keypair session or legacy API key | No | Hosted agent, cloud worker, webhook |

## Capabilities

| Capability | Local + ZK | Local + Server | Remote + ZK | Remote + Server |
|---|---|---|---|---|
| `read_ciphertext` | Allowed | Denied | Denied | Denied |
| `reveal_plaintext` | Denied | Allowed | Denied | Allowed |
| `mount_env` | Allowed | Allowed | Denied | Denied |
| `mount_file` | Allowed | Allowed | Denied | Denied |

## Permission Validation Rules

When creating a permission, the server enforces:

1. **Remote + ZK + any**: Denied. Remote agents cannot access ZK items at all.
2. **Remote + managed + reveal**: Allowed. This is the primary remote use case.
3. **Remote + managed + mount**: Denied. Remote agents cannot mount locally.
4. **Local + ZK + read_ciphertext**: Allowed. Returns encrypted blob for daemon decryption.
5. **Local + ZK + reveal_plaintext**: Denied. Server cannot decrypt ZK items.
6. **Local + ZK + mount**: Allowed. Daemon handles decryption and injection.
7. **Local + managed + any supported**: Allowed.
8. **read_ciphertext + server_managed**: Denied. No encrypted blob to return for server-managed items.

Invalid capability/locality/storage combinations return `INVALID_CAPABILITY_LOCALITY` or `INVALID_CAPABILITY_STORAGE` with an actionable hint.

```
Permission request: agent + item + capability
  │
  ├── Agent locality = remote?
  │     ├── Item = zero_knowledge? → DENIED (Remote cannot access ZK)
  │     └── Item = server_managed?
  │           ├── reveal_plaintext? → ALLOWED
  │           └── any other? → DENIED (Remote: reveal only)
  │
  └── Agent locality = local?
        ├── Item = zero_knowledge?
        │     ├── read_ciphertext? → ALLOWED
        │     ├── reveal_plaintext? → DENIED (Cannot reveal ZK)
        │     └── mount_env / mount_file? → ALLOWED
        └── Item = server_managed?
              ├── read_ciphertext? → DENIED (No encrypted blob for SM)
              ├── reveal_plaintext? → ALLOWED
              └── mount_env / mount_file? → ALLOWED
```

## Access Procedure Mapping

| Procedure | Required Capability | Item Mode | Agent Locality |
|----------|---------------------|-----------|--------------------|
| `trpc.access.ciphertext` | `read_ciphertext` | `zero_knowledge` | local |
| `trpc.access.reveal` | `reveal_plaintext` | `server_managed` | any |
| `trpc.access.mount` | `mount_env` or `mount_file` | any | local |

## Delivery Flow by Scenario

| Scenario | Flow |
|----------|------|
| User views ZK item in browser | Browser decrypts locally using root key in memory |
| CLI runs command with ZK secret | CLI → daemon (IPC) → daemon decrypts → daemon spawns subprocess with env var |
| Local MCP uses ZK secret | MCP → daemon (IPC) → daemon decrypts → daemon injects |
| Remote agent reveals managed secret | Agent → API (HTTPS) → server decrypts → returns plaintext |
| Remote agent tries to access ZK item | Denied at permission validation or access route |

## Field Delivery

All access methods accept an optional `field` parameter to select a specific named field from a multi-field item. Resolution is handled by `resolveFieldValue` from `@abadge/core/secret-delivery`.

- If `field` is omitted and the item has one field, that field is returned
- If `field` is omitted and the item has multiple fields, error `MULTI_FIELD_ITEM`
- If `field` is specified but does not exist, error `FIELD_NOT_FOUND`
- `--expand-env` on the CLI injects all fields as separate env vars

# ADR-001: Zero-Knowledge Vault Architecture

**Status:** Accepted
**Date:** 2026-04-01

## Context

Abadge is a credential control plane for AI agents. The original implementation used server-side AES-256-GCM encryption: the API received plaintext credentials, encrypted them at rest, and decrypted on authorized access. This means the server operator can always access secrets.

For a product claiming to secure credentials, this trust model is insufficient. Users must trust the server operator not to exfiltrate secrets. A breach of the server encryption key exposes all credentials for all users.

## Decision

Rewrite the credential storage system to be **zero-knowledge first** with an opt-in server-managed mode.

### Dual Storage Modes

| Mode | Encryption | Who can decrypt | Use case |
|------|-----------|-----------------|----------|
| `zero_knowledge` (default) | Client-side XChaCha20-Poly1305 via libsodium | Only the user (via master password) and their local agents | User secrets, local CLI/MCP usage |
| `server_managed` (opt-in) | Server-side AES-256-GCM envelope encryption | Server, for authorized remote agent access | Remote agent reveal, hosted workflows |

These are **separate items**, not dual-ciphertext on the same item.

### Key Hierarchy

```
Master Password → Argon2id → KEK → wraps → Root Key → wraps → Item DEK → encrypts → Item
```

- **Per-item Data Encryption Keys (DEKs)**: Each item gets its own random 32-byte DEK, wrapped by the user's root key. This provides blast-radius isolation and enables clean key rotation.
- **Root Key**: 32-byte random key generated client-side. Never sent to server in plaintext.
- **KEK**: Derived from master password via Argon2id. Used only to wrap/unwrap the root key.
- **Recovery Key**: 256-bit random key, shown once, wraps root key independently of KEK.

### Agent Split

Agents are split into two classes:

- **Local** (device, local_cli, local_mcp): Can access ZK items through the local daemon which holds the unlocked root key.
- **Remote** (remote_agent): Cannot decrypt ZK items. Can only access `server_managed` items via `reveal_plaintext` capability.

### Local Daemon (vaultd)

A TypeScript/Bun process that:
- Holds the unlocked root key in memory
- Exposes JSON-RPC 2.0 over Unix domain socket
- Serves CLI and local MCP as IPC clients
- Performs env injection and file mounting locally
- Auto-locks on timeout

Without the daemon, CLI and MCP cannot decrypt ZK items. The daemon is the secure local boundary.

### Browser as Convenience Mode

The web dashboard derives the KEK in the browser and holds the root key in JS memory for the session. This is explicitly weaker than the daemon model (XSS = catastrophic). Product language: "convenient security."

### What Gets Dropped

Connectors, auto-permissions, agent groups, broker sessions, policy engine, approval workflows, organization vault cryptography, browser_fill delivery mode. All can return in v2.

## Consequences

- Server cannot access ZK item plaintext even if fully compromised
- Users must manage a master password separate from their login
- Loss of master password + recovery key = permanent data loss (honest ZK)
- Remote agents cannot use ZK items directly (by design)
- Local daemon required for CLI/MCP ZK operations
- Simpler schema (5 domain tables vs ~15)
- Feature surface reduced for v1 but foundation is stronger

## Alternatives Considered

1. **Server-side encryption only (status quo)**: Rejected. Insufficient trust model for a security product.
2. **Pure ZK only (no server-managed mode)**: Rejected. Remote agents need plaintext for some use cases.
3. **Single root key encrypting items directly (no per-item DEKs)**: Rejected. No isolation, ugly rotation, no future sharing path.
4. **Passkeys replacing Better Auth**: Deferred. Major auth rewrite for marginal v1 benefit.
5. **Rust/Go daemon**: Deferred. TypeScript/Bun matches existing stack and is faster to build.

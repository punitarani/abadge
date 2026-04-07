# abadge

**The credential control plane for AI agents.**

---

## What is abadge?

abadge gives teams a single place to store secrets, decide which AI agents can use them, and see exactly what happened. Instead of scattering API keys in environment variables or giving agents broad access to a vault, abadge puts a policy-checked, audited gateway between every agent and every credential.

## The problem

AI agents are shipping to production. They sign into APIs, browse the web, talk to databases, and act on behalf of real users. But how they get credentials today is still one of four bad patterns:

- **Hardcoded** -- secrets embedded in code, prompts, or config files
- **Over-shared** -- plaintext environment variables available to everything on the machine
- **Over-privileged** -- agents given broad, standing access to an entire vault
- **Invisible** -- agent actions hidden behind shared human or service identities

When an agent leaks a credential or takes an unauthorized action, there is no way to trace it, scope the blast radius, or revoke just that agent's access.

## How abadge solves it

abadge introduces a credential control plane with four layers:

### 1. Store

Credentials live in abadge, encrypted at rest. Choose between:

- **Zero-knowledge mode** -- the server never sees plaintext. Encryption and decryption happen locally in the browser or CLI daemon using XChaCha20-Poly1305 with a master-password-derived key hierarchy.
- **Server-managed mode** -- the API worker encrypts with AES-256-GCM. Simpler to set up, but the server can decrypt.

### 2. Permission

Every agent must be explicitly granted access to each credential it needs. Permissions are scoped to a specific capability:

| Capability | What it allows |
|---|---|
| `read_ciphertext` | Download the encrypted blob (local agents, ZK items only) |
| `reveal_plaintext` | Decrypt and return the secret value (server-managed items) |
| `mount_env` | Inject the secret as an environment variable into a subprocess |
| `mount_file` | Write the secret to a temporary file with 0600 permissions |
| `use_without_reveal` | Acknowledge the secret exists without exposing it |

Permissions can have expiration dates. Remote agents are restricted to `reveal_plaintext` on server-managed items only.

### 3. Deliver

abadge controls how the secret reaches the agent:

- **Environment injection** -- `abadge run` spawns a subprocess with the secret in an env var. The secret lives only in process memory.
- **File mounting** -- `abadge mount` writes the secret to a temp file with restrictive permissions and auto-cleans up.
- **Direct reveal** -- for remote agents that need the plaintext value over HTTPS.
- **MCP tools** -- AI models never see raw secrets. The MCP server injects secrets into subprocesses and redacts them from output before returning to the LLM.

### 4. Audit

Every access attempt -- allowed or denied -- is logged to an append-only audit trail. Entries include the agent, credential, capability, delivery mode, outcome, and timestamp. Nothing is deleted.

## Surfaces

abadge exposes the same control plane through five interfaces:

| Surface | Audience | How it connects |
|---|---|---|
| **Dashboard** | Operators | Next.js web app with session cookies |
| **CLI** | Developers | Compiled binary, device-auth login, local daemon for ZK |
| **SDK** | Integrators | TypeScript client (`@abadge/sdk`) over tRPC |
| **MCP Server** | AI agents | Model Context Protocol tools, secrets never exposed to the LLM |
| **API** | Everything | tRPC on Cloudflare Workers, the canonical control plane |

## Who it's for

- **Teams building browser agents** that sign into websites on behalf of users
- **Workflow automation** that calls third-party APIs with customer credentials
- **Internal copilots** that need scoped access to company systems
- **B2B platforms** that act on behalf of customer accounts

## Architecture at a glance

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Dashboard  │  │     CLI     │  │     MCP     │  │ Remote Agent│
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       │         ┌──────┴──────┐         │                │
       │         │ Local Daemon│         │                │
       │         │  (ZK vault) │         │                │
       │         └──────┬──────┘         │                │
       │                │                │                │
       └────────────────┼────────────────┼────────────────┘
                        │                │
                 ┌──────┴────────────────┴──────┐
                 │   API  (Hono + tRPC on CF)   │
                 │  ┌─────┐ ┌──────┐ ┌───────┐  │
                 │  │Auth │ │Policy│ │ Audit │  │
                 │  └─────┘ └──────┘ └───────┘  │
                 └──────────────┬───────────────┘
                                │
                         ┌──────┴──────┐
                         │  PostgreSQL │
                         └─────────────┘
```

## Technology

| Layer | Technology |
|---|---|
| API | Hono on Cloudflare Workers |
| Dashboard | Next.js App Router via OpenNext |
| Database | PostgreSQL via Hyperdrive |
| ORM | Drizzle |
| Auth | Better Auth (session + device flow) |
| Validation | Zod + Effect Schema |
| ZK Crypto | XChaCha20-Poly1305 (libsodium), Argon2id KDF |
| Server Crypto | AES-256-GCM (WebCrypto) |
| Monorepo | Turborepo + Bun |

## Quick start

```bash
# Install the CLI
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash

# Authenticate
abadge login

# Store a secret
abadge item create --label "prod-db" --kind login --storage-mode server_managed

# Register an agent
abadge agent register -n "deploy-bot"

# Grant access
abadge permission create --agent-id <id> --item-id <id> --capability mount_env

# Run with the secret injected
abadge run --item <id> --env-var DB_PASSWORD -- ./deploy.sh
```

## Learn more

| Document | What it covers |
|---|---|
| [Workflows & Flows](./flow.md) | Visual diagrams of every workflow across all surfaces |
| [Entities & Data Model](./entities.md) | Database schema, entity relationships, and data lifecycle |
| [Security Model](./security.md) | Encryption, authentication, authorization, threat model |
| [API Reference](./specs/API.md) | Every tRPC procedure with input/output schemas |
| [CLI Reference](./specs/CLI.md) | All CLI commands and flags |
| [MCP Reference](./specs/MCP.md) | MCP tools and security constraints |
| [SDK Reference](./specs/SDK.md) | TypeScript client methods and examples |

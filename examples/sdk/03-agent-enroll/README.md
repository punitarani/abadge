# 03 — Agent enrollment (zero pre-shared secret)

**What this shows:** a CI job / remote worker's first run — generate an Ed25519 keypair locally, redeem a one-time bootstrap token to enroll the public key, then connect as an agent and read a granted secret. The private key never leaves the machine; only the public key is uploaded.

This is the canonical "GitHub Actions / remote worker first run" pattern.

## Prerequisites

- [Bun](https://bun.sh) (or Node 18+ with a TypeScript runner).
- An abadge API URL.
- An agent the operator has already **registered with `issueBootstrapToken: true`** and **granted the `read` capability** on the item you want to read. Registering the agent and granting the permission is the operator's job (management surface, `AbadgeUserClient`) — see example `01`. From it you need the agent's `id` and the one-time `bootstrapToken` (prefix `abe_`, 10-minute TTL).

## Setup

```bash
bun add @abadge/sdk @abadge/crypto
```

Set the environment variables (use real placeholders, never commit secrets):

```bash
export ABADGE_API_URL="https://api.abadge.dev"
export ABADGE_AGENT_ID="<agent id from the operator>"
export ABADGE_BOOTSTRAP_TOKEN="abe_..."   # one-time, expires in 10 minutes
export ABADGE_ITEM_ID="<item the agent was granted>"
```

How to get the bootstrap token (operator, once): register a `remote` agent with `issueBootstrapToken: true` via `AbadgeUserClient.agents.create(...)`, hand the returned `bootstrapToken` to the worker, and grant `permissions.create({ agentId, itemId, capabilities: ["read"] })`.

## Run

```bash
bun run enroll-and-read.ts
```

## Expected output

```
Generated Ed25519 keypair. Store the PRIVATE KEY as a CI secret:
  ABADGE_PRIVATE_KEY={"kty":"OKP","crv":"Ed25519",...,"d":"..."}
(The public key is uploaded during enroll; it is not sensitive.)

Enrolled agent <agent-id> at 2026-05-29T....Z.
Connected. Holding a short-lived abs_ session.

Read server-managed item "Prod API key".
Fields available: value
```

(Zero-knowledge items instead print an encrypted envelope to decrypt locally via the vault daemon.)

## How it works / security notes

- **Bootstrap-then-keypair beats a long-lived API key.** The bootstrap token is a single-use, 10-minute coupon whose only power is to bind the agent's own public key — once. The durable credential is the **Ed25519 private key**, which is generated locally and **never transmitted**. A leaked log line never contained it. Contrast a long-lived API key: it is the actual secret, valid forever, and travels over the wire at issuance.
- **`enroll()` is one-time.** First run only: `generateEd25519KeyPair()` → `enroll(bootstrapToken, publicKey)` → `connect()`. On every subsequent run you reuse the stored private key and go **straight to `connect()`** — re-redeeming a spent bootstrap token fails. Persist the private key in your CI secret store (GitHub Actions secret, Vault, encrypted runner env).
- **`enroll()` must run before `connect()`.** `connect()` performs an Ed25519 challenge/response: the server issues a challenge, the SDK signs it with the private key, the server verifies against the enrolled public key, and returns a short-lived `abs_` session token (15-minute TTL, auto-refreshed at T-2min).
- **Trust tier: this is the ACCESS surface.** Only an `AbadgeAgentClient` (keypair `abs_` session) with an explicit `(agent, item, capability)` permission can call `access.read`. A management credential (`abu_` personal API key or Better Auth session) is barred from `access.*` and would get `UNAUTHORIZED`. A CI job that must read a secret therefore runs as an **agent**, not a user.
- **Always `disconnect()` in `finally`** to stop the background refresh loop so the process exits cleanly.
- Every access attempt — allowed or denied — is written to the immutable audit log; the `purpose` string is recorded alongside it.

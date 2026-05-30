# 02 — Agent reads a granted secret and uses it

What this shows: an autonomous agent (a deployment bot) authenticates with its
Ed25519 keypair, reads a secret it has an explicit grant on via the **access
surface**, and uses the value to make an authenticated outbound API call —
handling both branches of the storage-mode discriminated union.

## Prerequisites

- Bun (or Node 18+ with `tsx`) — `fetch` and WebCrypto Ed25519 are required.
- An abadge API to talk to (`ABADGE_API_URL`).
- A registered **agent** with an Ed25519 keypair.
- A **server_managed** item, plus a `read` permission granting this agent
  access to it.

## Setup

Install the SDK in this directory:

```bash
bun add @abadge/sdk        # or: npm i @abadge/sdk
```

Provision an agent, an item, and a grant. This is **management-surface** work
(`AbadgeUserClient` / `abu_` personal API key / the `abadge` CLI / the
dashboard) — the management tier creates the agent and the permission but can
never read the secret value itself.

Using the CLI:

```bash
# 1. Register the agent. This writes a 0600 Ed25519 JWK keypair locally and
#    prints the agent id. Use that private key + id below.
abadge agent add --name "deploy-bot" --kind remote --json

# 2. Create a server_managed secret (piped via stdin; --value is rejected on a TTY).
echo -n 'super-secret-downstream-token' | abadge item add --label DEPLOY_TOKEN --kind token --json

# 3. Grant THIS agent read access on THAT item. Item-target CLI grants use the
#    legacy alias `reveal_plaintext`, which maps to canonical `read`.
abadge permission create --agent-id <AGENT_ID> --item-id <ITEM_ID> --capability reveal_plaintext
```

Export the environment the example reads:

```bash
export ABADGE_API_URL="https://api.abadge.dev"
export ABADGE_AGENT_ID="<AGENT_ID>"
export ABADGE_PRIVATE_KEY='{"kty":"OKP","crv":"Ed25519","x":"...","d":"..."}'  # JWK string
export ABADGE_ITEM_ID="<ITEM_ID>"
# Optional: a placeholder downstream API to hit with the secret.
export DOWNSTREAM_API_URL="https://httpbin.org/bearer"
```

The private key JWK is the file written by `abadge agent add` (under
`~/.abadge/agents/*.ed25519.jwk`), or any Ed25519 JWK whose public half you
registered with the agent.

## Run

```bash
bun run agent-read.ts
# or:  npx tsx agent-read.ts
```

## Expected output

For a `server_managed` item the bot can read and use:

```
Downstream https://httpbin.org/bearer -> HTTP 200
```

If the grant is missing:

```
[PERMISSION_DENIED] Agent is not permitted to read this item — grant (agent, item, read) on the management surface.
```

If the item is `zero_knowledge`:

```
Item <id> is zero_knowledge: returned an encrypted envelope ... Remote agents cannot decrypt ZK items — use a server_managed item instead.
```

## How it works / security notes

- **Two trust tiers.** Management credentials (`AbadgeUserClient`, `abu_` keys,
  Better Auth sessions) can create items, agents, and permissions but **cannot**
  call `access.*`. Only an **agent** (`AbadgeAgentClient`, Ed25519 keypair →
  `abs_` session) can read or use a secret value, and only with an explicit
  grant. A bot that must READ a secret is an agent, not a personal API key.
- **Keypair session exchange.** `connect()` signs a server challenge with the
  Ed25519 private key to obtain a short-lived `abs_` token (15-minute default
  TTL), then auto-refreshes at T-2 minutes. No long-lived bearer is stored on
  disk — the private key is the only durable credential.
- **Always `disconnect()`.** The refresh loop is a live timer; leaving it
  running keeps the process alive and keeps re-exchanging the session. The
  `finally` block stops it so the process exits cleanly.
- **Storage-mode union.** `access.read` returns either a `server_managed`
  payload (server decrypts AES-256-GCM on an authorized read — the path for
  remote agents) or a `zero_knowledge` envelope (server never sees plaintext;
  decryptable only by a local daemon holding the profile root key). Remote
  agents use server_managed items.
- **Audit trail.** Every read attempt — allowed or denied — is appended to the
  immutable audit log, tagged with the `purpose` string passed here.
- **Secret never logged.** The example prints only the downstream HTTP status,
  never the token value.

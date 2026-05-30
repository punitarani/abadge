# Agent access from Python (raw HTTP, no SDK)

A Python service authenticates as an abadge **agent** with its Ed25519 keypair,
exchanges a signed challenge for a short-lived `abs_` session token, then reads
a `server_managed` secret it has been granted. Shows non-TypeScript integration
against the bare REST API.

## Prerequisites

- Python 3.10+
- An abadge organization with:
  - a **registered agent** whose Ed25519 public key is enrolled, and
  - a **`server_managed` item** the agent has been granted the **`read`**
    capability on.
- The agent's Ed25519 **private key** as a JWK file (kept `0600`).

Why an agent and not a personal API key (`abu_`)? Only an agent keypair can
reach the access surface (`/v1/access/*`). A `abu_` management key can create
items and permissions but can never reveal a secret value.

## Setup

Install the two dependencies (a virtualenv is recommended):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Create the agent and grant it read access once, using the CLI (or the dashboard /
management API). CLI grants target a single item, so they use the legacy
capability name `reveal_plaintext` (it maps to canonical `read`, which is what
the `POST /v1/access/{itemId}/read` endpoint requires). Register it as a
`local_cli` agent: that kind generates an
Ed25519 keypair, uploads the public key (so the agent is enrolled and can sign
challenges immediately), and writes the **private key** to
`~/.abadge/agents/<agent-id>.ed25519.jwk` at mode `0600`. The locality is just
metadata — the keypair works fine for a remote Python HTTP client; the access
boundary is the permission, not where the agent runs.

```bash
# Register a keypair agent. --json prints the agent id AND the private-key path.
abadge agent add --name "py-reader" --kind local_cli --json
# → { "agent": { "id": "<AGENT_ID>", ... }, "privateKeyPath": "/Users/you/.abadge/agents/<AGENT_ID>.ed25519.jwk" }

# Grant it read access on the target item (legacy alias for canonical `read`).
abadge permission create --agent-id <AGENT_ID> --item-id <ITEM_ID> --capability reveal_plaintext
```

Then export the runtime config (take `ABADGE_PRIVATE_KEY_PATH` from the
`privateKeyPath` field above, or from `localAgents.cli.privateKeyPath` in
`~/.abadge/config.json`):

```bash
export ABADGE_API_URL="https://api.abadge.dev"
export ABADGE_AGENT_ID="<AGENT_ID>"
export ABADGE_ORG_ID="<ORG_ID>"
export ABADGE_ITEM_ID="<ITEM_ID>"
export ABADGE_PRIVATE_KEY_PATH="$HOME/.abadge/agents/<AGENT_ID>.ed25519.jwk"
```

(Alternatively, generate the keypair yourself and enroll a `remote` agent with a
one-time bootstrap token — see [`sdk/03-agent-enroll`](../../sdk/03-agent-enroll) —
then point `ABADGE_PRIVATE_KEY_PATH` at the JWK you saved.)

The JWK file must contain an Ed25519 key in WebCrypto export form:

```json
{ "kty": "OKP", "crv": "Ed25519", "x": "<base64url pubkey>", "d": "<base64url 32-byte seed>" }
```

## Run

```bash
python3 agent_read.py
```

## Expected output

```
Read server_managed secret 'value' (40 chars).
Available fields: ['value']
```

(The actual secret value is never printed — only its length and the field
names — so it stays out of stdout and logs.)

## How it works / security notes

1. **Challenge** — `POST /v1/agents/{agentId}/sessions/challenge` returns an
   opaque `abc_` challenge. No auth header; this is the agent bootstrap.
2. **Sign** — the agent signs the exact challenge string's UTF-8 bytes with its
   Ed25519 private key (no hashing), emitting unpadded base64url.
3. **Exchange** — `POST /v1/agents/{agentId}/sessions/exchange` verifies the
   signature against the enrolled public key and returns `session.token`
   (`abs_…`). The private key never leaves the host.
4. **Read** — `POST /v1/access/{itemId}/read` with `Authorization: Bearer
   abs_…` and `X-Abadge-Org-Id`. For `server_managed` items the API decrypts
   server-side and returns plaintext under `payload.fields`. For
   `zero_knowledge` items it returns only the encrypted blob — decryption needs
   the local daemon's in-memory root key, so this raw-HTTP example skips it.

Trust model: the `abs_` token is **short-lived (15 min default)**. A
long-running service must re-run steps 1–3 before expiry; the official SDK
(`AbadgeAgentClient`) does this automatically at T‑2 min. Every access attempt,
allowed or denied, is recorded in the append-only audit log.

# Raw REST management (curl, no SDK)

**What this shows:** drive the abadge management surface from any language or
runtime over plain HTTP — create a server-managed item, register an agent with
a bootstrap token, grant a permission, and read the audit log — using only
`curl` and an `abu_` personal API key.

## Prerequisites

- `bash`, `curl`, and [`jq`](https://jqlang.github.io/jq/) on your PATH
- An abadge organization and an `abu_` **personal API key** bound to it

No SDK, no Node, no install step. If you can make an HTTPS request, you can do
everything here in your own language — this script is just a readable reference.

## Setup

Get an `abu_` personal API key from the dashboard: **Settings → "API keys"**.
The key is shown **once**; copy it then. Then export the three required values:

```bash
export ABADGE_API_URL="https://api.abadge.dev"   # API base URL
export ABADGE_API_KEY="abu_..."                  # personal API key (shown once)
export ABADGE_ORG_ID="org_..."                   # the org the key is bound to
```

## Run

```bash
chmod +x manage.sh
./manage.sh
```

## Expected output

```
==> Creating server_managed item...
    item id: 6f1c...
==> Registering remote agent...
    agent id:        a1b2...
    bootstrap token: abe_...
==> Granting read permission...
[
  { "id": "...", "agentId": "a1b2...", "itemId": "6f1c...", "capability": "read", ... }
]
==> Last 10 audit entries...
[
  { "eventType": "permission.create", "result": "allowed", ... },
  { "eventType": "agent.create",      "result": "allowed", ... },
  { "eventType": "item.create",       "result": "allowed", ... }
]
==> Done.
```

## How it works / security notes

- **One helper, three headers.** Every authenticated management request sends
  `Authorization: Bearer <abu_ key>`, `X-Abadge-Org-Id: <orgId>`, and
  `Content-Type: application/json`. The `api()` helper centralizes that so no
  call can forget a header.

- **Exact request shapes.** `POST /v1/items` for a server-managed secret takes
  `{ storageMode, payload: { v, label, kind, tags, fields: { value } } }` — the
  value lives in `payload.fields`, and abadge encrypts it with AES-256-GCM
  server-side. Permissions use `capabilities` (a non-empty **array**), never a
  singular `capability`.

- **An `abu_` key is MANAGEMENT-ONLY.** This is the core invariant. A personal
  API key can create items, agents, and permissions and read the audit trail —
  but it **cannot** call `/v1/access/*` to read or use a secret *value*. Try it
  and you get `UNAUTHORIZED`. An `abu_` key never becomes an agent.

- **Reading a secret needs an agent.** To actually read the value, the agent
  registered above authenticates with its **Ed25519 keypair**: it requests a
  challenge, signs it, exchanges the signature for a short-lived `abs_` session
  token, and then — only with the explicit `read` permission granted here —
  calls `/v1/access/{itemId}/read`. That keypair/session/access flow is
  **example 09**. Keeping "manage the vault" and "read from the vault" on
  separate credentials is what makes abadge a credential firewall.

- **Errors are structured.** Non-2xx responses return
  `{ code, message, hint, meta }`. Branch on the stable `code`, surface
  `message`/`hint` to humans, and read `meta` for structured details. See the
  commented `UNAUTHORIZED` example at the bottom of `manage.sh`.

- **Audit everything.** Every mutation here (and every later agent access
  attempt, allowed or denied) is appended to the immutable audit log you read
  in step 4.

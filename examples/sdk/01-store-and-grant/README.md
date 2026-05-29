# SDK example 01 — Store a secret and grant an agent access

**What this shows:** the operator (management) side of abadge — store a `server_managed`
secret, register a remote agent with a one-time bootstrap token, grant the agent the
`read` capability on that item, and print the recent audit trail. It deliberately does
**not** read the secret value: that requires a keypair agent (example 02).

## Prerequisites

- [Bun](https://bun.sh) (or Node 20+ with a TypeScript loader)
- An abadge account in at least one organization
- One of:
  - a Better Auth **session token** (from a logged-in dashboard session), or
  - an **`abu_` personal API key** (org Settings → "API keys" in the dashboard)

Either credential authenticates the **management surface** only. Neither can read a
secret value — that is the whole point of the firewall.

## Setup

```bash
bun add @abadge/sdk          # or: npm i @abadge/sdk

export ABADGE_API_URL="https://api.abadge.dev"
export ABADGE_SESSION_TOKEN="abu_xxxxxxxx"   # or a Better Auth session token
export ABADGE_ORG_ID="org_xxxx"              # only if you belong to >1 org
export SECRET_TO_STORE="sk-the-real-value"   # optional; a placeholder is used otherwise
```

## Run

```bash
bun run store-and-grant.ts
```

## Expected output

```
Stored item: itm_...
Registered agent: agt_... (ci-deploy-bot)

=== SAVE THIS NOW — shown only once, expires in ~10 minutes ===
  Bootstrap token: abe_...
  Expires at:      2026-05-29T...
===============================================================

Granted 1 permission(s) on item itm_... to agent agt_...

Recent audit entries (3):
  2026-05-29T...  permission.create  result=allowed  item=itm_...  agent=agt_...
  2026-05-29T...  agent.create       result=allowed  agent=agt_...
  2026-05-29T...  item.create        result=allowed  item=itm_...

Done. The operator provisioned the credential but never read its value.
Only the keypair agent (example 02) can do that.
```

## How it works / security notes

- **Two trust tiers.** `AbadgeUserClient` (session token or `abu_` key) is management
  only: create items/agents/permissions, read audit, owner-reveal your own items. It
  **cannot** call `access.read` / `access.use` — those throw `UNAUTHORIZED` for this
  bearer. Reading a secret value requires `AbadgeAgentClient` with an Ed25519 keypair
  and an explicit permission. A CI job that must *read* a secret authenticates as an
  **agent**, not with `abu_`.
- **`read` vs `use`.** We grant `read` because the deploy bot needs the API key value
  delivered to it. Grant `use` instead when the agent should only mount the secret into
  a subprocess (env var / file) and never receive the value itself.
- **One-time bootstrap token.** The agent enrolls itself: it generates its own keypair
  and redeems the bootstrap token to bind its public key. The operator never holds the
  agent's private key, so the operator can never impersonate the agent's access.
- **Everything is audited.** Every management action and every (allowed or denied)
  access attempt is written to the append-only audit log, visible via `audit.list`.

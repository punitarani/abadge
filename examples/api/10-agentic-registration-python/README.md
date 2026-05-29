# Agentic self-registration (auth.md anonymous flow) — Python

**What this shows:** an agent with no abadge credential self-registers a *personal
account*, a human claims it by email + OTP, then the agent manages that account's
vault with the `abu_` management credential it received — zero-touch onboarding.

This implements the WorkOS [auth.md](https://auth.md) `anonymous` identity flow.

## The flow

1. **`POST /agent/auth`** — the agent registers an *unclaimed* personal account
   and gets back an `abu_` management credential plus a `clm_` claim token. The
   credential authenticates immediately but the account is inert until claimed.
2. **`POST /agent/auth/claim`** — the agent supplies the owner's email; abadge
   emails the owner a 6-digit OTP.
3. **`POST /agent/auth/claim/complete`** — the agent relays the OTP; abadge binds
   the verified email to the account in place (the `abu_` credential is upgraded
   to a claimed account).
4. **`POST /v1/items`** — the agent proves the `abu_` credential manages the
   vault by creating a server-managed item.

## Prerequisites

- Python 3.10+
- A running abadge API (local dev: `bun run dev` in the repo, default
  `http://localhost:8787`; or a deployed instance).
- Access to the inbox of the email you will claim with (to read the OTP). In
  local dev, the OTP email is delivered through whatever mail transport the API
  is configured with — check the dev mail sink / API logs.

## Setup

```bash
cd examples/api/10-agentic-registration-python
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export ABADGE_API_URL="http://localhost:8787"   # API root, no /v1 suffix
```

No credentials are needed up front — that is the point: the agent bootstraps its
own credential from nothing.

Optional env vars to run non-interactively (otherwise the script prompts):

```bash
export ABADGE_OWNER_EMAIL="owner@example.com"
export ABADGE_CLAIM_OTP="123456"   # only useful if you already know the code
```

## Run

```bash
python register.py
```

The script prompts for the owner email (step 2), waits while you fetch the OTP
from the inbox, then prompts for the 6-digit code (step 3).

## Expected output (sketch)

```
abadge agentic self-registration demo against http://localhost:8787

Step 1: POST /agent/auth (self-register anonymous personal account)
  registration_id:     a1b2c3d4-...
  credential (abu_):   abu_AbCdEfGh…  (management-only; store securely)
  claim_token (clm_):  clm_XyZ12345…
  claim_url:           http://localhost:8787/agent/auth/claim
  claim_token_expires: 2026-05-30T12:00:00.000Z  (24h TTL)
  scopes (pre-claim):  ['abadge:account.read']
  post_claim_scopes:   ['abadge:account.read', 'abadge:account.manage']

Owner email to claim this account: owner@example.com
Step 2: POST /agent/auth/claim (email an OTP to owner@example.com)
  status:     initiated
  expires_at: 2026-05-29T12:10:00.000Z  (OTP valid ~10 min)
  -> Ask the human to read the 6-digit code from their inbox.

6-digit OTP the owner received: 482915
Step 3: POST /agent/auth/claim/complete (verify OTP)
  status: claimed

Step 4: POST /v1/items (create a server_managed item with the abu_ credential)
  created item id: 7f8e9d...

  The abu_ credential managed the vault successfully.
  ...
Done. The personal account is claimed and managed by the abu_ credential.
```

## How it works / security notes

- **The account is a personal org.** Registration seeds a single-member
  organization flagged as personal, plus a default `server_managed` profile, so
  the vault is usable the instant it is claimed. No separate profile bootstrap.

- **The `abu_` credential is MANAGEMENT-ONLY.** It can create / list / update
  items, agents, permissions, and read audit on this account — but it can
  **never** reach the `access.*` surface (read / use a secret *value*); those
  calls return `UNAUTHORIZED`. The `abu_` key resolves to a *session* identity,
  never an agent identity. Reading a secret value still requires a separate
  Ed25519 **keypair agent** (`abs_` session) plus an explicit
  `(agent, item, capability)` permission. This is abadge's core trust boundary:
  managing the vault and using its secrets are different authorities.

- **No `X-Abadge-Org-Id` header needed here.** The register response carries no
  org id, and the `abu_` key binds to exactly one org (the personal account just
  created), which the server resolves from the sole membership. A multi-org user
  would set `X-Abadge-Org-Id: <orgId>` on `/v1/*` requests to disambiguate.

- **Discovery docs** describe this flow for autonomous agents:
  `GET /.well-known/oauth-protected-resource`,
  `GET /.well-known/oauth-authorization-server` (see the `agent_auth` block), and
  the human-readable skill manifest at `GET /auth.md`. Any `401` carries
  `WWW-Authenticate: Bearer resource_metadata=…` so an agent can rediscover the
  flow.

- **Abuse controls.** `/agent/auth*` is rate-limited to **60 requests/min/IP**.
  The OTP has a **10-minute TTL** and at most **5 attempts** before it is
  burned (each wrong guess is counted atomically). The claim token / unclaimed
  account expires after **24 hours** and is garbage-collected. Every step is
  audited (`account.register`, `account.claim`, `account.claim_complete`,
  including denied attempts).

- **Error envelope.** Every failure is `{ code, message, hint, meta }`. The
  script surfaces the stable `code` (for branching) and the human `hint`. Codes
  you may hit: `INVALID_CLAIM_TOKEN`, `CLAIM_TOKEN_EXPIRED`, `OTP_INVALID`,
  `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED`, `CLAIM_EMAIL_IN_USE`,
  `TOO_MANY_REQUESTS`.

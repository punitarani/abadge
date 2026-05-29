#!/usr/bin/env python3
"""
Agentic self-registration (auth.md "anonymous" flow) against the abadge REST API.

What this shows
---------------
An agent that has NO abadge credential bootstraps a *personal account* a human
later claims:

  1. POST /agent/auth                -> get an `abu_` management credential + a `clm_` claim token
  2. POST /agent/auth/claim          -> owner's email; abadge emails them a 6-digit OTP
  3. POST /agent/auth/claim/complete -> relay the OTP; the verified email is bound to the account
  4. POST /v1/items                  -> prove the `abu_` credential manages the now-claimed vault

Trust-tier note (the whole point of this example)
-------------------------------------------------
The `abu_` credential is a MANAGEMENT credential only. It can create / list /
update items, agents, permissions, and audit — but it can NEVER reach the
`access.*` surface (read / use a secret *value*); those throw UNAUTHORIZED.
Reading a secret value requires a separate Ed25519 *keypair agent* plus an
explicit (agent, item, capability) permission. `abu_` never becomes an agent.

All field names below are copied verbatim from the server contract:
  - request/response shapes: packages/core/src/schemas.ts
    (AgentRegisterAnonymousSchema / AgentClaimSchema / AgentClaimCompleteSchema
     and their *ResultSchema counterparts)
  - REST adapters:           apps/api/src/auth-md.ts
  - business logic:          packages/trpc/src/server/routers/agent-registration.ts
"""

import os
import sys

import requests

# Base URL of the abadge API root (NOT including /v1). e.g. https://api.abadge.dev
# The agentic-registration routes live at the root (/agent/auth*); the
# management routes live under /v1.
API_URL = os.environ.get("ABADGE_API_URL", "http://localhost:8787").rstrip("/")

TIMEOUT = 30


class AbadgeError(Exception):
    """Raised when the API returns an abadge error envelope: {code, message, hint, meta}."""

    def __init__(self, status: int, code: str, message: str, hint, meta) -> None:
        self.status = status
        self.code = code
        self.hint = hint
        self.meta = meta
        super().__init__(f"[{status} {code}] {message}" + (f" — hint: {hint}" if hint else ""))


def post(path: str, body: dict, *, bearer: str | None = None) -> dict:
    """POST JSON to the API and unwrap the abadge error envelope on failure.

    Every abadge error is the same shape: {code, message, hint, meta?}. We never
    print the raw response blindly — we surface the stable `code` (for branching)
    and the human `hint` (for the operator).
    """
    headers = {"Content-Type": "application/json"}
    if bearer:
        # The `abu_` credential is sent as a normal bearer token, exactly like a
        # Better Auth session token. The server resolves it to a *session*
        # identity, never an agent identity.
        headers["Authorization"] = f"Bearer {bearer}"

    resp = requests.post(f"{API_URL}{path}", json=body, headers=headers, timeout=TIMEOUT)

    try:
        data = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise AbadgeError(resp.status_code, "NON_JSON_RESPONSE", resp.text[:200], None, None)

    if not resp.ok:
        # 429 here means the per-IP abuse control tripped (60/min on /agent/auth*).
        raise AbadgeError(
            resp.status_code,
            data.get("code", "UNKNOWN"),
            data.get("message", "Request failed"),
            data.get("hint"),
            data.get("meta"),
        )
    return data


def step1_register() -> dict:
    """POST /agent/auth — register an unclaimed personal account.

    Request body: both fields are optional server-side, but we send them so the
    intent is self-documenting (it mirrors the /auth.md skill manifest).
    Response (AgentRegisterAnonymousResultSchema): we keep `credential` (the
    `abu_` key) and `claim_token` (the `clm_` token). The response carries NO
    org id — the credential binds to exactly one (user, org) pair server-side.
    """
    print("Step 1: POST /agent/auth (self-register anonymous personal account)")
    result = post(
        "/agent/auth",
        {"type": "anonymous", "requested_credential_type": "api_key"},
    )

    # Field names are verbatim from AgentRegisterAnonymousResultSchema.
    credential = result["credential"]  # the abu_ management credential (shown once)
    claim_token = result["claim_token"]  # the clm_ token the human's claim consumes

    print(f"  registration_id:     {result['registration_id']}")
    print(f"  credential (abu_):   {credential[:12]}…  (management-only; store securely)")
    print(f"  claim_token (clm_):  {claim_token[:12]}…")
    print(f"  claim_url:           {result['claim_url']}")
    print(f"  claim_token_expires: {result['claim_token_expires']}  (24h TTL)")
    print(f"  scopes (pre-claim):  {result['scopes']}")
    print(f"  post_claim_scopes:   {result['post_claim_scopes']}")
    print()
    return result


def step2_claim(claim_token: str, email: str) -> dict:
    """POST /agent/auth/claim — bind the owner's email and trigger an emailed OTP.

    Request body field names: `claim_token`, `email` (AgentClaimSchema).
    Response status is "initiated"; abadge emails a 6-digit code (10-minute TTL).
    """
    print(f"Step 2: POST /agent/auth/claim (email an OTP to {email})")
    result = post("/agent/auth/claim", {"claim_token": claim_token, "email": email})
    print(f"  status:     {result['status']}")  # "initiated"
    print(f"  expires_at: {result['expires_at']}  (OTP valid ~10 min)")
    print("  -> Ask the human to read the 6-digit code from their inbox.")
    print()
    return result


def step3_claim_complete(claim_token: str, otp: str) -> dict:
    """POST /agent/auth/claim/complete — relay the human's OTP to finish the claim.

    Request body field names: `claim_token`, `otp` (AgentClaimCompleteSchema).
    On success the verified email is bound to the placeholder account in place
    and the `abu_` credential's authority is upgraded to a claimed account.
    """
    print("Step 3: POST /agent/auth/claim/complete (verify OTP)")
    result = post("/agent/auth/claim/complete", {"claim_token": claim_token, "otp": otp})
    print(f"  status: {result['status']}")  # "claimed"
    print()
    return result


def step4_create_item(credential: str) -> dict:
    """POST /v1/items — prove the `abu_` credential works on the MANAGEMENT surface.

    Note: NO X-Abadge-Org-Id header. The register response carries no org id, and
    the `abu_` key binds to exactly one org (the personal account just created),
    which the server resolves from the sole membership. A *multi-org* user would
    set `X-Abadge-Org-Id: <orgId>` to disambiguate.

    This is a server_managed item: the plaintext is sent to the API, which
    encrypts it with AES-256-GCM. `profileId` is omitted so it lands in the
    seeded "default" profile.
    """
    print("Step 4: POST /v1/items (create a server_managed item with the abu_ credential)")
    result = post(
        "/v1/items",
        {
            "storageMode": "server_managed",
            "payload": {
                "v": 1,
                "label": "example-secret",
                "kind": "api_key",
                "tags": [],
                "fields": {"value": "demo-value-replace-me"},
            },
        },
        bearer=credential,
    )
    print(f"  created item id: {result['id']}")
    print()
    print("  The abu_ credential managed the vault successfully.")
    print("  It CANNOT, however, reveal this value: POST /v1/access/{id}/read with")
    print("  an abu_ bearer returns UNAUTHORIZED. Reading a secret value requires a")
    print("  keypair agent (abs_ session) + an explicit permission — by design.")
    return result


def main() -> int:
    print(f"abadge agentic self-registration demo against {API_URL}\n")

    try:
        registration = step1_register()
        credential = registration["credential"]
        claim_token = registration["claim_token"]

        # The agent asks the human operator for the account email it should claim.
        # Env var lets the demo run non-interactively (e.g. in CI).
        email = os.environ.get("ABADGE_OWNER_EMAIL") or input(
            "Owner email to claim this account: "
        ).strip()
        if not email:
            print("No email provided; aborting.", file=sys.stderr)
            return 1

        step2_claim(claim_token, email)

        # The human reads the 6-digit code from their inbox and hands it to the agent.
        otp = os.environ.get("ABADGE_CLAIM_OTP") or input(
            "6-digit OTP the owner received: "
        ).strip()
        if not otp:
            print("No OTP provided; aborting.", file=sys.stderr)
            return 1

        step3_claim_complete(claim_token, otp)
        step4_create_item(credential)

    except AbadgeError as err:
        # Stable `code` for branching, `hint` for the operator. Common codes here
        # (lowercase, as emitted by the agent-registration routes):
        #   invalid_claim_token / otp_not_requested / otp_invalid / otp_expired
        #   otp_attempts_exceeded / rate_limited
        print(f"\nAPI error: {err}", file=sys.stderr)
        return 1
    except requests.RequestException as err:
        print(f"\nNetwork error: {err}", file=sys.stderr)
        return 1

    print("\nDone. The personal account is claimed and managed by the abu_ credential.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

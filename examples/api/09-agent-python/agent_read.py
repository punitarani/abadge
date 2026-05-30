#!/usr/bin/env python3
"""
abadge agent access from Python over raw HTTP (no SDK).

What this shows
---------------
A non-TypeScript service authenticating as an abadge *agent* and reading a
secret it has been granted. abadge has two trust tiers:

  - Management surface (Better Auth session / `abu_` personal API key): can
    create items, agents, and permissions, but CANNOT read or use a secret's
    value. It never becomes an agent.
  - Access surface (`abs_` agent session, backed by an Ed25519 keypair): the
    ONLY tier that can reveal or mount a secret value, and only for items it
    has an explicit (agent, item, capability) permission on.

So a service that must *read* a secret authenticates as an AGENT with its
keypair -- exactly what this script does. The flow is:

  1. Load the agent's Ed25519 private key from a JWK file.
  2. Request a challenge for the agent.
  3. Sign the challenge string with the private key.
  4. Exchange the signed challenge for a short-lived `abs_` session token.
  5. Use that token (plus the org header) to read the granted secret.

The agent must already be enrolled (its public key uploaded at registration)
and granted read access on the target item. Do that once from the
dashboard, the CLI (`abadge agent add` + `abadge permission create
--capability reveal_plaintext`, the legacy alias for canonical `read` that
item-target grants require), or the management API -- not from this script.
"""

import base64
import json
import os
import sys

import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


# --- base64url helpers -------------------------------------------------------
# JWK fields (`d`, `x`) are base64url WITHOUT padding. Python's urlsafe_b64decode
# requires correct padding, so we re-pad before decoding. For encoding the
# signature we strip padding because abadge expects unpadded base64url (padded
# is also tolerated, but unpadded is the canonical form the SDK emits).


def b64url_decode(value: str) -> bytes:
    """Decode unpadded base64url, re-padding to a multiple of 4 chars."""
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def b64url_encode_nopad(data: bytes) -> str:
    """Encode bytes as base64url with '=' padding stripped."""
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


# --- key loading -------------------------------------------------------------


def load_private_key(jwk_path: str) -> Ed25519PrivateKey:
    """
    Load an Ed25519 private key from a JWK file.

    The JWK is the WebCrypto export format abadge uses:
      { "kty": "OKP", "crv": "Ed25519",
        "d": "<base64url 32-byte seed>",   # private scalar / seed
        "x": "<base64url public key>" }    # public key (not needed to sign)

    cryptography reconstructs the key from the 32-byte seed in `d`.
    """
    with open(jwk_path, "r", encoding="utf-8") as fh:
        jwk = json.load(fh)

    if jwk.get("kty") != "OKP" or jwk.get("crv") != "Ed25519":
        raise ValueError(
            f"expected an Ed25519 OKP JWK, got kty={jwk.get('kty')} crv={jwk.get('crv')}"
        )
    if "d" not in jwk:
        raise ValueError("JWK has no 'd' (private) component; this is a public-only key")

    seed = b64url_decode(jwk["d"])
    return Ed25519PrivateKey.from_private_bytes(seed)


# --- HTTP helper -------------------------------------------------------------


def post_json(url: str, body: dict, headers: dict | None = None) -> dict:
    """POST JSON and return the parsed body, raising on the abadge error envelope.

    Every abadge error is { code, message, hint, meta } with an appropriate HTTP
    status. We surface code + message + hint so failures are actionable.
    """
    resp = requests.post(url, json=body, headers=headers or {}, timeout=30)
    if not resp.ok:
        try:
            err = resp.json()
            code = err.get("code", "UNKNOWN")
            message = err.get("message", resp.text)
            hint = err.get("hint")
            detail = f"[{resp.status_code} {code}] {message}"
            if hint:
                detail += f"\n  hint: {hint}"
        except ValueError:
            detail = f"[{resp.status_code}] {resp.text}"
        raise SystemExit(f"abadge request failed: {detail}")
    return resp.json()


# --- main flow ---------------------------------------------------------------


def main() -> None:
    # All configuration comes from the environment -- never hardcode secrets or IDs.
    api_url = os.environ["ABADGE_API_URL"].rstrip("/")  # e.g. https://api.abadge.dev
    agent_id = os.environ["ABADGE_AGENT_ID"]
    org_id = os.environ["ABADGE_ORG_ID"]
    item_id = os.environ["ABADGE_ITEM_ID"]
    key_path = os.environ["ABADGE_PRIVATE_KEY_PATH"]

    private_key = load_private_key(key_path)

    # 1. Request a challenge. No auth header -- this is how an agent bootstraps
    #    a session over raw HTTP. The response carries an opaque `abc_` challenge.
    challenge_url = f"{api_url}/v1/agents/{agent_id}/sessions/challenge"
    challenge_resp = post_json(challenge_url, {"agentId": agent_id})
    challenge = challenge_resp["challenge"]
    challenge_id = challenge_resp["challengeId"]

    # 2. Sign the EXACT challenge string's UTF-8 bytes. Ed25519 signs the raw
    #    message (no pre-hashing). Emit the signature as unpadded base64url.
    signature = b64url_encode_nopad(private_key.sign(challenge.encode("utf-8")))

    # 3. Exchange the signed challenge for a session token. The server verifies
    #    the signature against the agent's enrolled public key and, on success,
    #    returns an `abs_` token. This proves possession of the private key
    #    without ever sending it.
    exchange_url = f"{api_url}/v1/agents/{agent_id}/sessions/exchange"
    exchange_resp = post_json(
        exchange_url,
        {
            "agentId": agent_id,
            "challengeId": challenge_id,
            "challenge": challenge,
            "signature": signature,
        },
    )
    session_token = exchange_resp["session"]["token"]  # abs_...
    # NOTE: `abs_` session tokens are short-lived (15 min default). A
    # long-running service must re-run steps 1-3 before expiry (the official
    # SDK auto-refreshes at T-2min). For a one-shot read this single token is
    # enough, so we don't schedule a refresh here.

    # 4. Read the granted secret. Authenticated routes require BOTH the bearer
    #    token and the X-Abadge-Org-Id header (items are org-scoped). The agent
    #    must hold a "read" permission on this item or the API returns FORBIDDEN
    #    -- and logs the denied attempt in the audit trail either way.
    read_url = f"{api_url}/v1/access/{item_id}/read"
    headers = {
        "Authorization": f"Bearer {session_token}",
        "X-Abadge-Org-Id": org_id,
    }
    read_resp = post_json(read_url, {"itemId": item_id}, headers=headers)

    storage_mode = read_resp.get("storageMode")
    if storage_mode == "server_managed":
        # server_managed items are decrypted server-side (AES-256-GCM) and the
        # plaintext fields are returned under `payload.fields`. The conventional
        # single-value field is "value".
        fields = read_resp["payload"]["fields"]
        secret_value = fields.get("value")
        # --- USE THE SECRET HERE -------------------------------------------
        # e.g. call a downstream API with this credential. We only print its
        # length so this example never leaks the value to stdout/logs.
        print(f"Read server_managed secret 'value' ({len(secret_value)} chars).")
        print(f"Available fields: {sorted(fields.keys())}")
    elif storage_mode == "zero_knowledge":
        # zero_knowledge items are never decrypted server-side. The API returns
        # the encrypted blob (encryptedItemKey + ciphertext); decryption needs
        # the profile root key, which only the local daemon (vaultd) holds in
        # memory after an unlock. Decrypting it here would mean reimplementing
        # the daemon's XChaCha20-Poly1305 unwrap -- out of scope for this raw
        # HTTP example. Use the CLI/MCP + local daemon for ZK items.
        print("Item is zero_knowledge; decryption requires the local daemon. Skipping.")
    else:
        print(f"Unexpected storage mode: {storage_mode!r}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

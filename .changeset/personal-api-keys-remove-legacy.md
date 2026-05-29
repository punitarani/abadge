---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add personal user API keys (`abu_`) and remove the legacy agent API key method.

**Personal API keys** — a long-lived credential bound to a (user, org) pair that authenticates the management API only. It resolves to a session identity, so it can never reach the agent-gated `access.*` surface (no secret reveal/mount). New `user_api_keys` table, `apiKeys.{create,list,revoke}` tRPC procedures, `POST/GET /v1/api-keys` + `DELETE /v1/api-keys/{keyId}` REST routes, and a dashboard Settings "API keys" section. `AbadgeUserClient` accepts an `abu_` key as its bearer token.

**Legacy agent API keys removed** — `legacy_api_key` (the `abl_`/`abg_` keys) is fully removed; agents now authenticate only via `public_key_session` (Ed25519 keypair → short-lived `abs_` sessions). Removed: the `agents.secretHash`/`secretPrefix` columns, agent API-key rotation (`agents.rotate`), the `apiKey`/`keyPrefix` fields, the `ABADGE_AUTH_TOKEN` env var, and the `AbadgeAgentApiKeyConfig` SDK config. Existing `legacy_api_key` agents lose their auth path (migration `0026`).

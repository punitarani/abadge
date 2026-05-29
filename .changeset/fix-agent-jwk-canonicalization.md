---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Fix agent session-exchange 500: canonicalize Ed25519 public-key JWKs to `{kty,crv,x}`. Node WebCrypto stamps a non-standard `alg:"Ed25519"` member on exported public-key JWKs, which Cloudflare Workers' `importKey` rejects — surfacing as a 500 during agent session-exchange. The server now canonicalizes registered/stored keys (also self-healing keys already in the DB at verify time) and `verifyEd25519` fails closed: a malformed key or signature is an audited 401, never a 500. cli/mcp patch — release-surface dependency closure (both depend on `@abadge/crypto` + `@abadge/trpc`); no direct CLI/MCP behavior change.

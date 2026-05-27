---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add the per-profile server-managed DEK crypto primitives (AB-0030 crypto core): `generateServerDek`, `wrapServerDek`, and `unwrapServerDek` in `@abadge/crypto/server`, with golden-vector tests pinning the v3 wire format defined in `docs/ENVELOPE_SPEC.md`. The wrap AES-256-GCM-encrypts a 32-byte profile DEK under the master `ENCRYPTION_KEY`, AAD-bound to `(orgId, profileId)` so a wrapped DEK cannot be transplanted between profiles; v3 item content encrypts under the DEK via the existing key-agnostic `serverEncrypt`. No behavior change yet — the primitives are wired into the item create/decrypt paths in a follow-up PR. Bundled into the CLI/MCP binaries.

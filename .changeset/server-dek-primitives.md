---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add the per-profile server-managed DEK crypto primitives (AB-0030 crypto core): `generateServerDek`, `wrapServerDek`, and `unwrapServerDek` in `@abadge/crypto/server`, with golden-vector tests pinning the wire format defined in ENVELOPE_SPEC v3. These wrap a 32-byte profile DEK under the master `ENCRYPTION_KEY` (AES-256-GCM); v3 item content encrypts under the DEK via the existing key-agnostic `serverEncrypt`. No behavior change yet — the primitives are wired into the item create/decrypt paths in a follow-up PR. Bundled into the CLI/MCP binaries.

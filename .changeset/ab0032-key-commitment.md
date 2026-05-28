---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add key commitment to the server-managed AEAD envelope (AB-0032). New server-managed writes are now `serverKeyVersion = 4`: a 32-byte HMAC-SHA256(DEK, fixed-context) commitment is prefixed to the AES-GCM ciphertext and verified constant-time on decrypt, binding each ciphertext to the exact per-profile DEK (defeats AES-GCM key-confusion / partitioning-oracle attacks). v1–v3 rows decrypt unchanged. No API or behavior change for callers.

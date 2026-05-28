---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Track server-managed encryption count per profile; warn at 2^27 uses to flag approaching AES-GCM nonce saturation (§AB-0031).

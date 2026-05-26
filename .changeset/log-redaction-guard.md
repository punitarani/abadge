---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add a structured-logging redaction guard (AB-0091). New `redactSecrets` helper masks secret-bearing keys (value/fields/payload/password/token/ciphertext/...) at every depth, and is wired into the audit-failure warning so a failed audit write can't surface a secret to Workers observability. A regression guard test captures all console output during an agent reveal and asserts the decrypted plaintext never appears — failing loudly if a future debug log prints a payload.

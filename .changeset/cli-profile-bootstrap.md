---
"@abadge/cli": patch
---

Add `abadge profile bootstrap [name-or-id]` to initialize a zero-knowledge profile's master password from the CLI. Previously the CLI could create a ZK profile but never bootstrap it, so zero-knowledge mode — the flagship client-side-encryption feature — was unusable from the CLI (you could only bootstrap via the web/SDK). Bootstrap derives the KEK locally (Argon2id), wraps a fresh root key, sets up a recovery key, and binds the wrap AAD to `{profileId, keyVersion:1}` exactly like the web flow, so a CLI-bootstrapped profile is unlockable via `abadge profile unlock`. `profile add --storage-mode zero_knowledge` now points users to the bootstrap step.

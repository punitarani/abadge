---
"@abadge/cli": patch
---

`item update` is now scriptable: added `--label`/`--name`, `--kind`, and `--value` flags (mirroring `item add`, including the `--value` TTY-rejection guard). Previously the Label/Kind prompts used readline, which buffers all piped stdin and starved the value read, so `item update` could not be driven non-interactively (it errored "Label, kind, and value are required"). Supplying `--label`/`--kind` now bypasses the prompts so a piped value reaches `readSecretValue` (or pass `--value` from a non-interactive shell).

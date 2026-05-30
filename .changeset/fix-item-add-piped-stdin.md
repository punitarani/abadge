---
"@abadge/cli": patch
---

Fix `item add` silently storing nothing when the value is piped without a trailing newline (e.g. the quickstart's `echo -n 'secret' | abadge item add`). Piped (non-TTY) stdin is now read to EOF as the value, and prompt chrome is written to stderr so `--json` output stays clean.

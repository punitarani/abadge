---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Follow-up to PR #116 review feedback. Two small fixes:

- `abadge agent register` now rejects `--json` + `--mcp-config` up front instead of accepting both. The combination produced a single nested JSON document that worked, but mixing a script-oriented flag (`--json`) with a human-paste flag (`--mcp-config`) is confusing. Use `abadge agent register --json` for scripts, then `abadge agent mcp-config <id>` to print the snippet.
- `install.sh` now emits an explicit `warning:` line on stderr when `ABADGE_INSTALL_BASE_URL` is set without a scoped version. Previously a multi-package install (`ABADGE_INSTALL_PACKAGE=all`) would silently skip every package without explanation; the operator now sees which env var to set.

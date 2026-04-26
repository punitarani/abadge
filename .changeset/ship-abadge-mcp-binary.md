---
"@abadge/mcp": patch
"@abadge/cli": patch
---

Ship `abadge-mcp` as a distributable binary. The MCP server now releases through the same
GitHub Actions pipeline as the CLI: per-platform `bun --compile` artifacts, SHA256-verified
tarballs, and the existing `install.sh` installer (extended to support
`ABADGE_INSTALL_PACKAGE={cli|mcp|all}` plus scoped `ABADGE_CLI_VERSION` /
`ABADGE_MCP_VERSION` pins). `install.sh` defaults to installing both binaries when invoked
without env vars.

Add `--mcp-config` to `abadge agent register` and a standalone `abadge agent mcp-config <id>`
subcommand. Both emit a paste-ready Claude Desktop `mcpServers` JSON snippet using absolute
paths so it works under launchd/systemd-spawned MCP clients that do not inherit
`~/.abadge/bin` in `$PATH`.

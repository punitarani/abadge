---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add a comprehensive `examples/` tree (10 runnable examples across the SDK, CLI, MCP, and HTTP API) and wire it into the docs: a new Mintlify Examples page, navigation entry, and cross-links from the quickstart, SDK installation, and MCP Claude Desktop pages. Also corrects a stale CLI flag in the MCP Claude Desktop doc (`--agent`/`--item` → `--agent-id`/`--item-id`) and the mount delivery wording (`mountType: file` → `delivery: file`). Documentation-only — no CLI or MCP behavior change; patch to ship the updated release-surface docs (`README.md`, `apps/docs/mcp/`).

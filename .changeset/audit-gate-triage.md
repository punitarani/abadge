---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Pull upstream security fixes for bundled transitive dependencies via root `overrides` — `kysely` ≥0.28.17 (JSON-path injection), `fast-uri` ≥3.1.2 (host confusion + path traversal, reached through the MCP SDK), and `fast-xml-builder` ≥1.1.7. No API or behavior changes; this is dependency hardening that flows into the CLI and MCP binaries. The CI dependency-audit gate is now blocking, backed by an expiring allowlist (AB-0104).

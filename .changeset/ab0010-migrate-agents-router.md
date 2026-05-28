---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Route the agents router through `scopedDb` (AB-0010 PR-B). Org-scoped reads use `findMany`/`findFirst` (the org filter is baked in), inserts use `scope.insert`, and the by-PK update / agent-context self-fetch / revoke transaction use the escape hatch — every query preserved exactly, with the rotate and revoke updates also AND-ing in the org scope so the writes are self-defending. `agents.ts` no longer imports tenant tables directly and is removed from the import-ban allowlist. No behavior change.

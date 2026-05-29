---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Re-route the profiles and organizations tRPC routers through the `scopedDb` org choke-point so tenant-table access carries its org filter again. A stale-base merge in #180 reverted the AB-0010 scoped-DAL routing in both routers, which (a) re-introduced the direct tenant-table imports the import-ban ratchet forbids and (b) made a cross-org `profiles.bootstrap` return `FORBIDDEN` instead of `NOT_FOUND`, reopening a cross-org existence oracle. The fix keeps #180's `scopedSessionProcedure` / `app.current_org` GUC wiring and restores the scoped queries on top of it (defense in depth: app-layer org filter + RLS backstop).

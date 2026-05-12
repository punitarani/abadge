---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add an end-to-end test suite (`apps/e2e`) that boots a real `wrangler dev`
API against the test Postgres and drives it through three surfaces: the
SDK over HTTP, the compiled `abadge` CLI binary as a subprocess, and the
`abadge-mcp` stdio server as a JSON-RPC peer. Internal-only — no behavior
change in either shipped binary; the patch bump is bookkeeping for the
shared `packages/trpc/` and root `package.json` files the harness adds
test-only entries to.

Run locally with `bun run test:e2e` after `docker compose up -d`. CI gains
an `e2e` job gated before deploy.

---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add coverage reporting for unit and integration tests via Bun's built-in
`bun test --coverage`. CI gains two new jobs (`test-unit`, `test-integration`)
that upload `lcov.info` artifacts (`coverage-unit`, `coverage-integration`),
plus a `test-web` job for the web component tests. The existing `e2e` job is
unchanged and intentionally produces no coverage — Bun's instrumentation
cannot see across the workerd / compiled-binary boundary, and the same code
paths are exercised in-process by the integration bucket. Internal-only — no
behavior change in either shipped binary; the patch bump is bookkeeping for
the root `package.json` and `docs/DEVELOPMENT.md` files this PR touches.

Run locally with `bun run test:cov:unit`, `bun run test:cov:integration`, or
`bun run test:cov`. Bucket assignment lives in `scripts/coverage/buckets.ts`.

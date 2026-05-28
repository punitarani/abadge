// Single source of truth for which test files belong to which coverage bucket.
// Consumed by scripts/coverage/run.ts; referenced by docs/CI.md and TESTING.md.
//
// Buckets:
//   unit        — pure in-process tests (no DB, no spawned servers/binaries)
//   integration — tests against real Postgres (TEST_DATABASE_URL) or that
//                 spawn in-process servers/subprocesses
//   e2e         — apps/e2e (boots wrangler-dev + spawned binaries). Not
//                 included here: bun's coverage cannot instrument across the
//                 workerd/binary boundary, so e2e is excluded from coverage on
//                 purpose. The integration bucket covers the same code paths
//                 in-process.
//
// apps/web and apps/docs are intentionally out of scope.

export type Bucket = "unit" | "integration";

export const BUCKETS: Record<Bucket, readonly string[]> = {
  unit: [
    "apps/api/**/*.test.ts",
    "packages/auth/**/*.test.ts",
    "packages/cli/**/*.test.ts",
    "packages/core/**/*.test.ts",
    "packages/crypto/**/*.test.ts",
    "packages/db/**/*.test.ts",
    "packages/env/**/*.test.ts",
    "packages/daemon/src/identity.test.ts",
    "packages/daemon/src/vault-state.test.ts",
    "packages/mcp/**/*.test.ts",
    "packages/sdk/src/secret-value.test.ts",
    "packages/sdk/src/errors.test.ts",
    "packages/sdk/src/resolve-private-key.test.ts",
    "packages/sdk/src/client.unit.test.ts",
    "packages/sdk/src/validation-issue.test.ts",
    "packages/sdk/src/trpc.test.ts",
    "packages/trpc/src/client.test.ts",
    "packages/trpc/src/server/*.test.ts",
    "packages/trpc/src/server/routers/*.test.ts",
    "scripts/*.test.ts",
    "scripts/coverage/*.test.ts",
  ],
  integration: [
    "packages/trpc/src/server/__tests__/integration/**/*.test.ts",
    "packages/trpc/src/server/__tests__/e2e/**/*.test.ts",
    "packages/daemon/src/server.test.ts",
    "packages/daemon/src/client.test.ts",
    "packages/sdk/src/client.test.ts",
  ],
};

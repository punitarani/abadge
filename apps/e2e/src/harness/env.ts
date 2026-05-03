import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_ENV } from "@abadge/trpc/test-helpers";

export const E2E_BETTER_AUTH_SECRET = TEST_ENV.BETTER_AUTH_SECRET;
export const E2E_ENCRYPTION_KEY = TEST_ENV.ENCRYPTION_KEY;

const DEFAULT_TEST_DB = "postgresql://abadge:abadge@localhost:5432/abadge_test";
// biome-ignore lint/style/noRestrictedGlobals: harness runs outside @abadge/env validation
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;

/**
 * Allocate a free TCP port by binding to :0, capturing the assigned port,
 * and immediately releasing it. There is a tiny race window between release
 * and the wrangler bind, but it is the same window every Node test harness
 * accepts and has not been a source of flakes in practice.
 */
export async function allocatePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = Number(server.url.port);
  server.stop(true);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("could not allocate a port");
  }
  return port;
}

export function mkTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `abadge-e2e-${prefix}-`));
}

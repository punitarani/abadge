import { describe, expect, test } from "bun:test";
import { appRouter } from "./router";

/**
 * Guard rail for the REST surface.
 *
 * The `apps/api` REST adapter at `/v1/*` compiles its routing table from
 * `.meta({ openapi })` annotations on each tRPC procedure. This test runs
 * in the same package as those annotations so it sees the real router
 * (`apps/api` tests `mock.module("@abadge/trpc/server")`, which would
 * shadow the production router at this assertion).
 */
describe("OpenAPI annotation coverage (PR3 §4.1)", () => {
  const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })
    ._def.procedures;

  const annotated = Object.entries(procedures).filter(([_path, proc]) => {
    const p = proc as { _def?: { meta?: { openapi?: unknown } } };
    return Boolean(p._def?.meta?.openapi);
  });

  test("at least 30 procedures expose a REST path", () => {
    expect(annotated.length).toBeGreaterThanOrEqual(30);
  });

  test("every annotation declares method, path, tags, and protect", () => {
    for (const [path, proc] of annotated) {
      const meta = (proc as { _def?: { meta?: { openapi?: Record<string, unknown> } } })._def?.meta
        ?.openapi;
      expect(meta).toBeDefined();
      expect(meta?.method, `${path} missing method`).toBeTruthy();
      expect(meta?.path, `${path} missing path`).toBeTruthy();
      expect(Array.isArray(meta?.tags), `${path} missing tags`).toBe(true);
      expect(typeof meta?.protect, `${path} missing protect`).toBe("boolean");
    }
  });

  test("no two procedures collide on the same method+path", () => {
    const seen = new Map<string, string>();
    for (const [path, proc] of annotated) {
      const meta = (proc as { _def?: { meta?: { openapi?: { method?: string; path?: string } } } })
        ._def?.meta?.openapi;
      if (!meta?.method || !meta.path) continue;
      const key = `${meta.method} ${meta.path}`;
      const prev = seen.get(key);
      expect(prev, `${path} collides with ${prev} on ${key}`).toBeUndefined();
      seen.set(key, path);
    }
  });
});

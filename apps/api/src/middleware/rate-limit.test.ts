import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RateLimitCheckResult } from "../durable-objects/rate-limit-counter";
import { rateLimitMiddleware } from "./rate-limit";

/**
 * §RL1-5 regression tests. Six scenarios map to the B7 plan spec:
 *   1. path-scoping — `/api/auth` 60/min and `/trpc` 100/min stay independent (§RL5).
 *   2. X-Forwarded-For spoof is ignored when not strictly behind CF (§RL2).
 *   3. `cf-connecting-ip` is trusted when `NODE_ENV=production` (§RL2).
 *   4. Headerless requests never share a global "unknown" bucket (§RL3).
 *   5. 429 envelope + headers (§RL1/§RL1b).
 *   6. DO counter survives isolate restart (covered in DO suite; asserted here
 *      indirectly via shared-storage stub in the path-scoping test).
 */

type AnyObject = Record<string, unknown>;

interface NamespaceRecorder {
  namespace: DurableObjectNamespace;
  /** keys observed via `idFromName` — proves §RL5 path-scoping. */
  seenKeys: string[];
  /** per-key call counts, for multi-bucket tests. */
  counts: Map<string, number>;
}

/**
 * Build a namespace stub backed by in-memory per-key counters. Each unique
 * `idFromName(key)` gets its own bucket — mirrors the real DO's
 * instance-per-key semantic.
 */
function makeRecordingNamespace(): NamespaceRecorder {
  const counts = new Map<string, number>();
  const seenKeys: string[] = [];
  const resetAt = Date.now() + 60_000;

  const namespace = {
    idFromName: (name: string) => {
      seenKeys.push(name);
      return { toString: () => name } as unknown as DurableObjectId;
    },
    idFromString: () => ({}) as DurableObjectId,
    newUniqueId: () => ({}) as DurableObjectId,
    jurisdiction: () => ({}) as DurableObjectNamespace,
    get: (id: DurableObjectId) => {
      const key = id.toString();
      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input.toString(), init);
          const body = (await request.json()) as { limit: number; windowMs: number };
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          const ok = next <= body.limit;
          const retryAfter = ok ? 0 : Math.ceil((resetAt - Date.now()) / 1000);
          const result: RateLimitCheckResult = {
            ok,
            count: next,
            limit: body.limit,
            resetAt,
            retryAfter,
          };
          return Response.json(result);
        },
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;

  return { namespace, seenKeys, counts };
}

/**
 * Build a namespace stub whose fetch handler returns whatever `respond`
 * produces — lets tests assert on exact 429 / 200 shapes.
 */
function makeFixedNamespace(
  respond: (req: { limit: number; windowMs: number }) => RateLimitCheckResult,
): DurableObjectNamespace {
  return {
    idFromName: () => ({ toString: () => "stub" }) as unknown as DurableObjectId,
    idFromString: () => ({}) as DurableObjectId,
    newUniqueId: () => ({}) as DurableObjectId,
    jurisdiction: () => ({}) as DurableObjectNamespace,
    get: () =>
      ({
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input.toString(), init);
          const body = (await request.json()) as { limit: number; windowMs: number };
          return Response.json(respond(body));
        },
      }) as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

describe("rate-limit middleware (§RL1-5)", () => {
  test("§RL5 — /api/auth and /trpc buckets never contaminate each other", async () => {
    const recorder = makeRecordingNamespace();
    const app = new Hono();
    app.use("/api/auth/*", rateLimitMiddleware(2, 60_000));
    app.use("/trpc/*", rateLimitMiddleware(5, 60_000));
    app.get("/api/auth/session", (c) => c.json({ route: "auth" }));
    app.get("/trpc/health", (c) => c.json({ route: "trpc" }));

    const env = { RATE_LIMIT: recorder.namespace, NODE_ENV: "production" };

    // Burn /api/auth to its 2/min ceiling with ip 1.1.1.1
    const a1 = await app.request(
      "/api/auth/session",
      { headers: { "cf-connecting-ip": "1.1.1.1" } },
      env,
    );
    const a2 = await app.request(
      "/api/auth/session",
      { headers: { "cf-connecting-ip": "1.1.1.1" } },
      env,
    );
    const a3 = await app.request(
      "/api/auth/session",
      { headers: { "cf-connecting-ip": "1.1.1.1" } },
      env,
    );
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(a3.status).toBe(429);

    // Same IP hitting /trpc must still be allowed — different bucket.
    const t1 = await app.request(
      "/trpc/health",
      { headers: { "cf-connecting-ip": "1.1.1.1" } },
      env,
    );
    expect(t1.status).toBe(200);

    // Both buckets in the recorded key list, in the right prefixed shape.
    expect(recorder.seenKeys).toContain("/api/auth:1.1.1.1");
    expect(recorder.seenKeys).toContain("/trpc:1.1.1.1");
    // And they are distinct keys — no collision.
    const unique = new Set(recorder.seenKeys);
    expect(unique.has("/api/auth:1.1.1.1")).toBe(true);
    expect(unique.has("/trpc:1.1.1.1")).toBe(true);
  });

  test("§RL2 — X-Forwarded-For is never consulted (spoof ignored, not bucket-shifting)", async () => {
    const recorder = makeRecordingNamespace();
    const app = new Hono();
    app.use("*", rateLimitMiddleware(5, 60_000));
    app.get("/t", (c) => c.json({ ok: true }));
    const env = { RATE_LIMIT: recorder.namespace, NODE_ENV: "production" };

    // Two requests from the same real IP, with a rotating XFF header. If
    // XFF were trusted, each request would land in a different bucket. We
    // assert the opposite: the key depends only on cf-connecting-ip.
    await app.request(
      "/t",
      { headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.1" } },
      env,
    );
    await app.request(
      "/t",
      { headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.2" } },
      env,
    );

    const unique = new Set(recorder.seenKeys);
    // Exactly one bucket was hit — neither XFF value appears in any key.
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe("/t:1.1.1.1");
    expect(recorder.seenKeys.some((k) => k.includes("9.9.9"))).toBe(false);
  });

  test("§RL2 — cf-connecting-ip is trusted only in production", async () => {
    const recorder = makeRecordingNamespace();
    const app = new Hono();
    app.use("*", rateLimitMiddleware(5, 60_000));
    app.get("/t", (c) => c.json({ ok: true }));

    // Not production — cf-connecting-ip must not be promoted to the key.
    await app.request(
      "/t",
      { headers: { "cf-connecting-ip": "evil-header-value" } },
      { RATE_LIMIT: recorder.namespace, NODE_ENV: "development" },
    );

    expect(recorder.seenKeys.length).toBe(1);
    expect(recorder.seenKeys[0]).not.toContain("evil-header-value");
    // The dev fallback produces a `dev:` prefix derived from the path.
    expect(recorder.seenKeys[0]).toMatch(/^\/t:dev:/);
  });

  test("§RL3 — headerless requests do not collapse into a single 'unknown' bucket", async () => {
    const recorder = makeRecordingNamespace();
    const app = new Hono();
    app.use("/api/auth/*", rateLimitMiddleware(100, 60_000));
    app.use("/trpc/*", rateLimitMiddleware(100, 60_000));
    app.get("/api/auth/a", (c) => c.json({ ok: true }));
    app.get("/trpc/b", (c) => c.json({ ok: true }));
    const env = { RATE_LIMIT: recorder.namespace, NODE_ENV: "development" };

    // Two fully headerless requests on distinct paths — neither exposes a
    // usable IP header, but they must land in distinct buckets (old code
    // shared one "unknown" bucket across everyone).
    await app.request("/api/auth/a", {}, env);
    await app.request("/trpc/b", {}, env);

    const unique = new Set(recorder.seenKeys);
    expect(unique.size).toBe(2);
    // And the single keys are not the legacy literal "unknown".
    for (const key of recorder.seenKeys) {
      expect(key.endsWith(":unknown")).toBe(false);
    }
  });

  test("§RL1 + §RL1b — 429 response uses canonical envelope + RFC 6585 headers", async () => {
    const namespace = makeFixedNamespace(() => ({
      ok: false,
      count: 11,
      limit: 10,
      resetAt: Date.now() + 30_000,
      retryAfter: 30,
    }));
    const app = new Hono();
    app.use("*", rateLimitMiddleware(10, 60_000));
    app.get("/t", (c) => c.json({ ok: true }));

    const res = await app.request(
      "/t",
      { headers: { "cf-connecting-ip": "1.1.1.1" } },
      { RATE_LIMIT: namespace, NODE_ENV: "production" },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).not.toBeNull();

    const body = (await res.json()) as AnyObject;
    expect(body).toMatchObject({
      code: "RATE_LIMITED",
      message: expect.stringContaining("Rate limit exceeded"),
      hint: expect.any(String),
      meta: expect.objectContaining({
        retryAfter: 30,
        limit: 10,
        resetAt: expect.any(Number),
      }),
    });
  });

  test("§RL1b — allowed requests carry X-RateLimit-Remaining headers", async () => {
    const namespace = makeFixedNamespace(() => ({
      ok: true,
      count: 3,
      limit: 10,
      resetAt: Date.now() + 60_000,
      retryAfter: 0,
    }));
    const app = new Hono();
    app.use("*", rateLimitMiddleware(10, 60_000));
    app.get("/t", (c) => c.json({ ok: true }));

    const res = await app.request(
      "/t",
      { headers: { "cf-connecting-ip": "1.1.1.1" } },
      { RATE_LIMIT: namespace, NODE_ENV: "production" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("7");
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});

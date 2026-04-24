import { describe, expect, test } from "bun:test";
import { type RateLimitCheckResult, RateLimitCounter } from "./rate-limit-counter";

/**
 * Minimal DurableObjectState storage stub — enough surface for
 * RateLimitCounter. We only exercise `storage.get` / `storage.put` with the
 * single "bucket" key.
 */
function makeStateStub() {
  const store = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
  return { storage, store };
}

function check(counter: RateLimitCounter, limit: number, windowMs: number) {
  return counter.fetch(
    new Request("https://rate-limit.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit, windowMs }),
    }),
  );
}

describe("RateLimitCounter (§RL4 — cross-isolate-consistent counter)", () => {
  test("first request returns ok: true with count: 1", async () => {
    const stub = makeStateStub();
    const counter = new RateLimitCounter(stub as unknown as DurableObjectState);

    const res = await check(counter, 10, 60_000);
    const result = (await res.json()) as RateLimitCheckResult;

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.retryAfter).toBe(0);
  });

  test("limit requests ok, (limit + 1)th rejected with retryAfter > 0", async () => {
    const stub = makeStateStub();
    const counter = new RateLimitCounter(stub as unknown as DurableObjectState);

    for (let i = 0; i < 10; i++) {
      const res = await check(counter, 10, 60_000);
      const body = (await res.json()) as RateLimitCheckResult;
      expect(body.ok).toBe(true);
    }

    const res = await check(counter, 10, 60_000);
    const body = (await res.json()) as RateLimitCheckResult;
    expect(body.ok).toBe(false);
    expect(body.count).toBe(11);
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  test("window reset starts a fresh bucket once resetAt is in the past", async () => {
    const stub = makeStateStub();
    const counter = new RateLimitCounter(stub as unknown as DurableObjectState);

    for (let i = 0; i < 11; i++) {
      await check(counter, 10, 60_000);
    }
    // Simulate window expiry by overwriting the stored resetAt.
    await stub.storage.put("bucket", { count: 11, resetAt: Date.now() - 1_000 });

    const res = await check(counter, 10, 60_000);
    const body = (await res.json()) as RateLimitCheckResult;
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
  });

  test("state persists across isolate restarts (simulated via shared storage)", async () => {
    // §RL4 regression: the old module-level Map was per-isolate; this test
    // proves two freshly-constructed counters backed by the same storage see
    // the same count.
    const stub = makeStateStub();
    const first = new RateLimitCounter(stub as unknown as DurableObjectState);
    for (let i = 0; i < 5; i++) {
      await check(first, 10, 60_000);
    }

    // "Restart" — new RateLimitCounter instance, same storage.
    const second = new RateLimitCounter(stub as unknown as DurableObjectState);
    const res = await check(second, 10, 60_000);
    const body = (await res.json()) as RateLimitCheckResult;
    expect(body.count).toBe(6);
    expect(body.ok).toBe(true);
  });

  test("rejects non-/check paths with 404", async () => {
    const counter = new RateLimitCounter(makeStateStub() as unknown as DurableObjectState);
    const res = await counter.fetch(new Request("https://rate-limit.internal/other"));
    expect(res.status).toBe(404);
  });

  test("rejects non-POST /check with 404", async () => {
    const counter = new RateLimitCounter(makeStateStub() as unknown as DurableObjectState);
    const res = await counter.fetch(
      new Request("https://rate-limit.internal/check", { method: "GET" }),
    );
    expect(res.status).toBe(404);
  });
});

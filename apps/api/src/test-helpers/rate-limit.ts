import type { RateLimitCheckResult } from "../durable-objects/rate-limit-counter";

/**
 * Minimal DurableObjectNamespace stub that always answers `ok: true`.
 * Used by tests that exercise app-level wiring (envelope uniformity,
 * body limits, tRPC passthrough) without caring about rate-limit
 * mechanics themselves.
 */
export function makeAllowAllRateLimitStub(): DurableObjectNamespace {
  return makeRateLimitNamespaceStub(() => ({
    ok: true,
    count: 1,
    limit: 100,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }));
}

/**
 * Stub that answers with the provided check result. Useful for tests that
 * need deterministic 429 behavior (e.g. checking the response envelope).
 */
export function makeRateLimitNamespaceStub(
  respond: (req: { limit: number; windowMs: number }) => RateLimitCheckResult,
): DurableObjectNamespace {
  const idStub = {
    toString: () => "stub-id",
    equals: () => true,
    name: undefined,
  } as unknown as DurableObjectId;

  const stub: DurableObjectStub = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      const body = (await request.json().catch(() => ({ limit: 0, windowMs: 0 }))) as {
        limit: number;
        windowMs: number;
      };
      return Response.json(respond(body));
    },
  } as unknown as DurableObjectStub;

  return {
    idFromName: () => idStub,
    idFromString: () => idStub,
    newUniqueId: () => idStub,
    get: () => stub,
    jurisdiction: () => ({}) as DurableObjectNamespace,
  } as unknown as DurableObjectNamespace;
}

/**
 * Unit coverage for the SDK's tRPC plumbing — toHeaderRecord (Headers /
 * record / array / undefined input variants) and normalizeTrpcError (which
 * extracts httpStatus/code/hint/meta/issues from a tRPC client error).
 *
 * The SDK doesn't export these helpers as public API, so we re-import
 * them via `./trpc` directly inside the package.
 */
import { describe, expect, test } from "bun:test";
import { normalizeTrpcError } from "./trpc";

// -----------------------------------------------------------------------------
// We exercise the internal toHeaderRecord through the public createNodeTrpcClient
// surface (it's used inside the headers() callback). Because httpBatchLink
// captures the headers() function, we instantiate the client and inspect its
// behaviour by intercepting fetch.
// -----------------------------------------------------------------------------

import { createNodeTrpcClient } from "./trpc";

function captureHeaders(
  options: Parameters<typeof createNodeTrpcClient>[0],
): Promise<Record<string, string>> {
  const originalFetch = globalThis.fetch;
  return new Promise<Record<string, string>>((resolve, reject) => {
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      try {
        const headersIn = init?.headers ?? {};
        const captured: Record<string, string> = {};
        new Headers(headersIn as HeadersInit).forEach((value, key) => {
          captured[key] = value;
        });
        resolve(captured);
      } catch (err) {
        reject(err);
      } finally {
        globalThis.fetch = originalFetch;
      }
      return new Response(JSON.stringify({ result: { data: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = createNodeTrpcClient(options) as unknown as {
      health: { query: () => Promise<unknown> };
    };
    // Fire any query — we only need fetch() to be called once.
    client.health.query?.().catch(() => undefined);
  });
}

describe("createNodeTrpcClient header building", () => {
  test("token alone produces an Authorization: Bearer header", async () => {
    const headers = await captureHeaders({ baseUrl: "http://x", token: "tok_x" });
    expect(headers.authorization).toBe("Bearer tok_x");
  });

  test("orgId is sent as X-Abadge-Org-Id when provided", async () => {
    const headers = await captureHeaders({
      baseUrl: "http://x",
      token: "tok",
      orgId: "org_1",
    });
    expect(headers["x-abadge-org-id"]).toBe("org_1");
  });

  test("baseUrl trailing slash is normalised before /trpc is appended", async () => {
    // The fetch URL contains the normalised baseUrl + /trpc/...
    const originalFetch = globalThis.fetch;
    let observedUrl = "";
    globalThis.fetch = (async (input: unknown) => {
      observedUrl = String(input);
      globalThis.fetch = originalFetch;
      return new Response(JSON.stringify({ result: { data: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = createNodeTrpcClient({ baseUrl: "http://x/" }) as unknown as {
      health: { query: () => Promise<unknown> };
    };
    await client.health.query?.().catch(() => undefined);
    expect(observedUrl.startsWith("http://x/trpc/")).toBe(true);
  });

  test("Headers-instance input is forwarded via toHeaderRecord", async () => {
    const h = new Headers();
    h.set("X-Custom", "yes");
    const headers = await captureHeaders({ baseUrl: "http://x", headers: h });
    expect(headers["x-custom"]).toBe("yes");
  });

  test("plain Record input is forwarded; null/undefined values are dropped", async () => {
    const headers = await captureHeaders({
      baseUrl: "http://x",
      headers: { "X-Keep": "v", "X-Drop": null, "X-Skip": undefined },
    });
    expect(headers["x-keep"]).toBe("v");
    expect(headers["x-drop"]).toBeUndefined();
    expect(headers["x-skip"]).toBeUndefined();
  });

  test("array-valued header value is joined with ', '", async () => {
    const headers = await captureHeaders({
      baseUrl: "http://x",
      headers: { "X-Multi": ["a", "b"] },
    });
    expect(headers["x-multi"]).toBe("a, b");
  });
});

describe("normalizeTrpcError", () => {
  test("non-object input returns the fallback shape", () => {
    expect(normalizeTrpcError(null)).toEqual({ message: "Unknown error" });
    expect(normalizeTrpcError(undefined)).toEqual({ message: "Unknown error" });
    expect(normalizeTrpcError("string-throw")).toEqual({ message: "Unknown error" });
  });

  test("preserves message + httpStatus + code + hint + meta", () => {
    const out = normalizeTrpcError({
      message: "Profile not found",
      data: {
        httpStatus: 404,
        code: "PROFILE_NOT_FOUND",
        hint: "Re-create",
        meta: { profileId: "p_x" },
      },
    });
    expect(out).toEqual({
      message: "Profile not found",
      httpStatus: 404,
      trpcCode: "PROFILE_NOT_FOUND",
      code: "PROFILE_NOT_FOUND",
      hint: "Re-create",
      meta: { profileId: "p_x" },
      issues: undefined,
    });
  });

  test("falls back to a generic message when the error object has none", () => {
    expect(normalizeTrpcError({})).toEqual({
      message: "Request failed",
      httpStatus: undefined,
      trpcCode: undefined,
      code: undefined,
      hint: undefined,
      meta: undefined,
      issues: undefined,
    });
  });

  test("ignores meta when it's an array (must be a plain object)", () => {
    const out = normalizeTrpcError({
      message: "x",
      data: { meta: [1, 2, 3] },
    });
    expect(out.meta).toBeUndefined();
  });

  test("keeps malformed httpStatus undefined", () => {
    const out = normalizeTrpcError({
      message: "x",
      data: { httpStatus: "not-a-number" },
    });
    expect(out.httpStatus).toBeUndefined();
  });
});

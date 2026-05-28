import { describe, expect, mock, test } from "bun:test";
import { makeAllowAllRateLimitStub } from "./test-helpers/rate-limit";
import type { Bindings } from "./types";

// Stub the tRPC module before the app imports it. `appRouter._def.procedures`
// must exist so the /v1 route compilation at module load doesn't crash; we
// expose one minimal annotated procedure to verify route discovery.
mock.module("@abadge/trpc/server", () => {
  const procedures: Record<string, unknown> = {
    "health.ping": {
      _def: {
        type: "query",
        meta: {
          openapi: {
            method: "GET",
            path: "/_test/ping",
            tags: ["health"],
            protect: false,
          },
        },
      },
    },
  };
  return {
    handleTrpcRequest: () => new Response("mock trpc"),
    appRouter: { _def: { procedures } },
    createServerCaller: () => ({
      health: {
        ping: async () => ({ pong: true }),
      },
    }),
    createServerCallerContext: () => ({ caller: {}, resHeaders: new Headers() }),
  };
});

const { default: app } = await import("./index");

const testEnv: Bindings = {
  ABADGE_API_URL: "http://localhost:8787",
  ABADGE_APP_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "test-encryption-key",
  BETTER_AUTH_SECRET: "test-better-auth-secret",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  GITHUB_CLIENT_ID: "test-github-client-id",
  GITHUB_CLIENT_SECRET: "test-github-client-secret",
  RATE_LIMIT: makeAllowAllRateLimitStub(),
  SEND_EMAIL: { send: async () => {} } as unknown as SendEmail,
};

describe("api app", () => {
  test("GET /health returns ok and does not leak the DB role to anon callers", async () => {
    const response = await app.request("http://localhost/health", undefined, testEnv);
    const body = (await response.json()) as { status: string; db: unknown };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    // No DB binding in the unit env → db is null (a configured-but-unreachable DB
    // returns 503 `degraded`). The role name and bypassRls attribute must never
    // appear in the public payload.
    expect(body.db).toBeNull();
    expect(JSON.stringify(body)).not.toContain("bypassRls");
    expect(JSON.stringify(body)).not.toContain("role");
  });

  test("tRPC endpoint is reachable", async () => {
    const response = await app.request("http://localhost/trpc/health", undefined, testEnv);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("mock trpc");
  });

  test("unknown v1 routes return 404 envelope", async () => {
    const response = await app.request("http://localhost/v1/bogus-route", undefined, testEnv);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("NOT_FOUND");
  });

  test("GET /v1/health returns 200 and X-Request-Id header", async () => {
    const response = await app.request("http://localhost/v1/health", undefined, testEnv);

    expect(response.status).toBe(200);
    const reqId = response.headers.get("X-Request-Id");
    expect(reqId).toBeTruthy();
    expect(reqId).toMatch(/^req_/);
  });

  test("X-Request-Id echoes a valid caller-supplied id", async () => {
    const response = await app.request(
      "http://localhost/v1/health",
      { headers: { "X-Request-Id": "abc-12345" } },
      testEnv,
    );
    expect(response.headers.get("X-Request-Id")).toBe("abc-12345");
  });

  test("X-Request-Id rejects malformed id and mints a fresh one", async () => {
    const response = await app.request(
      "http://localhost/v1/health",
      { headers: { "X-Request-Id": "bad id with spaces!" } },
      testEnv,
    );
    const reqId = response.headers.get("X-Request-Id");
    expect(reqId).toMatch(/^req_/);
  });

  test("404 envelopes still carry X-Request-Id", async () => {
    const response = await app.request("http://localhost/v1/totally-missing", undefined, testEnv);
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Request-Id")).toMatch(/^req_/);
  });

  test("REST adapter routes to tRPC caller (mocked procedure)", async () => {
    const response = await app.request("http://localhost/v1/_test/ping", undefined, testEnv);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { pong: boolean };
    expect(body.pong).toBe(true);
  });

  test("GET /v1/openapi.json returns an OpenAPI 3.1 document", async () => {
    const response = await app.request("http://localhost/v1/openapi.json", undefined, testEnv);
    expect(response.status).toBe(200);
    const doc = (await response.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("abadge API");
    // The mocked router contributes exactly 1 path; the real router
    // contributes 30+ in production (verified by smoke test).
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(1);
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
  });

  test("tRPC responses carry Cache-Control: no-store", async () => {
    const response = await app.request("http://localhost/trpc/access.read", undefined, testEnv);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  test("v1 (REST) responses carry Cache-Control: no-store", async () => {
    const response = await app.request("http://localhost/v1/_test/ping", undefined, testEnv);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  // The unit env has no DB binding, so the auth handler throws and the response
  // comes from app.onError — this also proves no-store survives the error path.
  test("auth (/api/auth/*) responses carry Cache-Control: no-store", async () => {
    const response = await app.request(
      "http://localhost/api/auth/sign-in",
      { method: "POST" },
      testEnv,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });

  test("non-secret top-level /health is not marked no-store", async () => {
    const response = await app.request("http://localhost/health", undefined, testEnv);
    expect(response.headers.get("Cache-Control")).not.toBe("no-store, no-cache, must-revalidate");
  });
});

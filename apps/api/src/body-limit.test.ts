import { describe, expect, mock, test } from "bun:test";
import { makeAllowAllRateLimitStub } from "./test-helpers/rate-limit";
import type { Bindings } from "./types";

mock.module("@abadge/trpc/server", () => ({
  handleTrpcRequest: () => new Response("mock trpc"),
}));

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
};

// §DoS2: bodyLimit middleware must reject oversized requests before auth/rate-limit
// runs. Without it, 100 req/min × 100MB = 10 GB/min unauthenticated write amplification.
describe("Hono body limit (§DoS2)", () => {
  test("accepts body under 1MB", async () => {
    // 500KB body — well under the 1MB cap
    const body = JSON.stringify({ x: "a".repeat(500_000) });
    const res = await app.request(
      "http://localhost/health",
      { method: "POST", body, headers: { "content-type": "application/json" } },
      testEnv,
    );
    // /health only handles GET; POST returns 404. Key assertion: NOT 413.
    expect(res.status).not.toBe(413);
  });

  test("rejects body over 1MB with PAYLOAD_TOO_LARGE envelope", async () => {
    const body = "x".repeat(2_000_000); // 2MB
    // Real HTTP clients always send Content-Length with POST bodies.
    // Hono bodyLimit uses it for fast-path rejection when present.
    const res = await app.request(
      "http://localhost/health",
      {
        method: "POST",
        body,
        headers: { "content-type": "text/plain", "content-length": String(body.length) },
      },
      testEnv,
    );
    expect(res.status).toBe(413);
    const json = (await res.json()) as {
      code: string;
      message: string;
      hint: string;
      meta: { maxBytes: number };
    };
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
    expect(json.message).toContain("1MB");
    expect(json.meta?.maxBytes).toBe(1_048_576);
    expect(json.hint).toBeTruthy();
  });
});

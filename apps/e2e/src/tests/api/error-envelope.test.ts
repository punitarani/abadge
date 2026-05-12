/**
 * §ENV2 — every error response carries the canonical
 * `{ code, message, hint, meta }` envelope. The in-process tests in
 * packages/trpc cover this at the tRPC layer; we verify it survives Hono
 * + the bodyLimit / cors / secureHeaders / Better Auth middleware stack.
 */
import { describe, expect, test } from "bun:test";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

interface ErrorEnvelope {
  code?: string;
  message?: string;
  hint?: string | null;
  meta?: unknown;
}

describe("error envelope uniformity", () => {
  test("404 returns canonical envelope", async () => {
    const res = await fetch(`${stack.apiUrl()}/this-route-does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
    expect(body.meta).toBeTruthy();
  });

  test("payload over 1MB is rejected with PAYLOAD_TOO_LARGE", async () => {
    const oversized = "x".repeat(1_100_000);
    const res = await fetch(`${stack.apiUrl()}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.z", password: oversized, name: "x" }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("unauthenticated tRPC call returns UNAUTHORIZED with envelope", async () => {
    const res = await fetch(`${stack.apiUrl()}/trpc/items.list`);
    // tRPC envelope nests under .error.json.data.code, but the HTTP status
    // and shape from the Hono adapter must still be a structured JSON body.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as {
      error?: {
        json?: { message?: string; data?: { code?: string } };
        data?: { code?: string };
      };
    };
    const code = body.error?.json?.data?.code ?? body.error?.data?.code;
    expect(code).toBe("UNAUTHORIZED");
  });
});

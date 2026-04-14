import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { AbadgeAgentClient } from "./client";

/**
 * Stub tRPC-batch server for AbadgeAgentClient.connect().
 *
 * The client hits two mutations (`auth.createChallenge`, `auth.exchangeSession`)
 * before arming the refresh timer. We only need just-enough tRPC batch wire
 * shape to get the happy path through `connect()`; we don't verify cryptography.
 */
function makeBatchResponse(results: unknown[]): Response {
  const body = results.map((data) => ({ result: { data } }));
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeStubJwk(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return JSON.stringify(privateKey.export({ format: "jwk" }));
}

describe("AbadgeAgentClient refresh timer lifecycle", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let apiUrl = "";

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        // tRPC batch URL shape: /trpc/<procedure>?batch=1
        if (url.pathname === "/trpc/auth.createChallenge") {
          return makeBatchResponse([
            {
              challengeId: "abc_test_challenge_id",
              challenge: "test-challenge-material",
            },
          ]);
        }
        if (url.pathname === "/trpc/auth.exchangeSession") {
          // 15-minute session expiry matches prod default; refresh timer
          // will be scheduled at T-2 min (~13 min out). The test must not
          // wait for that — .unref() is what we're verifying.
          const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          return makeBatchResponse([
            {
              session: {
                token: "abs_test_session_token",
                expiresAt,
              },
            },
          ]);
        }
        return new Response("not found", { status: 404 });
      },
    });
    apiUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("arms an unref'd refresh timer after connect()", async () => {
    // Observing `hasRef()` on the private refreshTimer field right after
    // connect() resolves is cleaner than spying on globalThis.setTimeout
    // (which is awkward across realms).
    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: "agent_test",
      privateKey: makeStubJwk(),
    });

    try {
      await client.connect();

      // Reach into the private field — this is a test-only invariant check.
      // Bun's Timer exposes `hasRef()` (Node compat); if .unref() ran,
      // hasRef() returns false. Absence of hasRef means we're in an env
      // where ref tracking is a no-op and the assertion is trivially true.
      const timer = (client as unknown as { refreshTimer: unknown }).refreshTimer;
      expect(timer).toBeDefined();
      expect(timer).not.toBeNull();

      const hasRef = (timer as { hasRef?: () => boolean }).hasRef;
      if (typeof hasRef === "function") {
        expect(hasRef.call(timer)).toBe(false);
      }
    } finally {
      // Deterministic cleanup — disconnect() clears the timer regardless
      // of ref state. This is also the canonical caller-side teardown.
      client.disconnect();
    }
  });
});

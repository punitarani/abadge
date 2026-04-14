import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { AbadgeAgentClient, REFRESH_RETRY_SCHEDULE_MS } from "./client";
import { AbadgeApiError } from "./errors";

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

/** Per-test control surface for the stub server. */
interface ServerState {
  challengeFailuresRemaining: number;
  exchangeFailuresRemaining: number;
  requestCount: number;
}

describe("AbadgeAgentClient refresh timer lifecycle", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let apiUrl = "";
  const state: ServerState = {
    challengeFailuresRemaining: 0,
    exchangeFailuresRemaining: 0,
    requestCount: 0,
  };

  function resetServer(): void {
    state.challengeFailuresRemaining = 0;
    state.exchangeFailuresRemaining = 0;
    state.requestCount = 0;
  }

  function handleChallenge(): Response {
    if (state.challengeFailuresRemaining > 0) {
      state.challengeFailuresRemaining--;
      return new Response("simulated upstream failure", { status: 503 });
    }
    return makeBatchResponse([
      { challengeId: "abc_test_challenge_id", challenge: "test-challenge-material" },
    ]);
  }

  function handleExchange(): Response {
    if (state.exchangeFailuresRemaining > 0) {
      state.exchangeFailuresRemaining--;
      return new Response("simulated upstream failure", { status: 503 });
    }
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return makeBatchResponse([{ session: { token: "abs_test_session_token", expiresAt } }]);
  }

  function handleSelf(): Response {
    return makeBatchResponse([
      {
        agent: {
          id: "agent_test",
          organizationId: "org_test",
          name: "test",
          kind: "remote",
          locality: "remote",
          authMethod: "public_key_session",
          enabled: true,
        },
      },
    ]);
  }

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        state.requestCount++;
        const path = new URL(req.url).pathname;
        if (path === "/trpc/auth.createChallenge") return handleChallenge();
        if (path === "/trpc/auth.exchangeSession") return handleExchange();
        if (path === "/trpc/agents.self") return handleSelf();
        return new Response("not found", { status: 404 });
      },
    });
    apiUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("arms an unref'd refresh timer after connect()", async () => {
    resetServer();
    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: "agent_test",
      privateKey: makeStubJwk(),
    });

    try {
      await client.connect();

      const timer = (client as unknown as { refreshTimer: unknown }).refreshTimer;
      expect(timer).toBeDefined();
      expect(timer).not.toBeNull();

      const hasRef = (timer as { hasRef?: () => boolean }).hasRef;
      if (typeof hasRef === "function") {
        expect(hasRef.call(timer)).toBe(false);
      }
    } finally {
      client.disconnect();
    }
  });

  /**
   * Synchronous scheduler test seam: each scheduled callback is captured and
   * fired manually by the test. This lets us drive the entire bounded-backoff
   * flow without sleeping through 30s+ real timers. The returned handle
   * satisfies the clearTimeout contract via `ref/unref` no-ops + id.
   */
  interface CapturedCallback {
    callback: () => void;
    delayMs: number;
  }

  function makeSyncScheduler(): {
    scheduler: (cb: () => void, delay: number) => ReturnType<typeof setTimeout>;
    captured: CapturedCallback[];
    fireNext: () => Promise<void>;
  } {
    const captured: CapturedCallback[] = [];
    const scheduler = ((cb: () => void, delay: number) => {
      captured.push({ callback: cb, delayMs: delay });
      // Return a stub handle with just enough surface for `clearTimeout` +
      // the optional `unref` / `hasRef` accessors the client touches.
      const handle = {
        _captured: true,
        unref() {
          return this;
        },
        ref() {
          return this;
        },
        hasRef() {
          return false;
        },
      };
      return handle as unknown as ReturnType<typeof setTimeout>;
    }) as (cb: () => void, delay: number) => ReturnType<typeof setTimeout>;

    /**
     * Fire the next captured callback and wait until either a new callback is
     * captured (retry or next T-2min refresh was scheduled) OR the queue stays
     * empty across several event-loop turns (exhausted). Yields many times so
     * the real HTTP fetch inside `exchangeSessionOnce` has a chance to settle.
     */
    const fireNext = async (): Promise<void> => {
      const next = captured.shift();
      if (!next) throw new Error("no callback captured");
      const startLen = captured.length; // should be 0 at this point typically
      next.callback();
      for (let i = 0; i < 50; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        if (captured.length > startLen) return;
      }
    };

    return { scheduler, captured, fireNext };
  }

  test("onSessionError fires on each failed refresh attempt", async () => {
    resetServer();
    const errors: Array<{ error: Error; attempt: number }> = [];
    const { scheduler, captured, fireNext } = makeSyncScheduler();

    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: "agent_test",
      privateKey: makeStubJwk(),
      onSessionError: (error, attempt) => {
        errors.push({ error, attempt });
      },
      schedulerFn: scheduler,
    });

    try {
      await client.connect();
      // Initial connect succeeded — one refresh timer armed.
      expect(captured.length).toBe(1);

      // Fail the next 3 refresh attempts. Each failure schedules the next
      // retry via `schedulerFn`, so the captured queue never goes empty
      // until exhaustion (or until the test stops firing).
      state.challengeFailuresRemaining = 100; // effectively always fail
      await fireNext(); // attempt 0 fails -> schedules retry
      await fireNext(); // attempt 1 fails -> schedules retry
      await fireNext(); // attempt 2 fails -> schedules retry

      expect(errors.length).toBe(3);
      expect(errors[0]?.attempt).toBe(0);
      expect(errors[1]?.attempt).toBe(1);
      expect(errors[2]?.attempt).toBe(2);
    } finally {
      client.disconnect();
    }
  });

  test("flips to sessionExpired after exhausting all attempts", async () => {
    resetServer();
    const { scheduler, captured, fireNext } = makeSyncScheduler();

    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: "agent_test",
      privateKey: makeStubJwk(),
      schedulerFn: scheduler,
    });

    try {
      await client.connect();
      expect(captured.length).toBe(1);

      state.challengeFailuresRemaining = 100;

      // attempt 0 .. N where N = REFRESH_RETRY_SCHEDULE_MS.length all fail.
      // After that, no more retries are scheduled and sessionExpired flips.
      const totalAttempts = REFRESH_RETRY_SCHEDULE_MS.length + 1;
      for (let i = 0; i < totalAttempts; i++) {
        if (captured.length === 0) break;
        await fireNext();
      }

      // No further timer should be queued — exhausted.
      expect(captured.length).toBe(0);

      const flag = (client as unknown as { sessionExpired: boolean }).sessionExpired;
      expect(flag).toBe(true);

      // Outgoing API call must now fast-reject with SESSION_REFRESH_FAILED.
      state.challengeFailuresRemaining = 0;
      let caught: unknown;
      try {
        await client.getCurrentAgent();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AbadgeApiError);
      expect((caught as AbadgeApiError).code).toBe("SESSION_REFRESH_FAILED");
      expect((caught as AbadgeApiError).statusCode).toBe(401);
    } finally {
      client.disconnect();
    }
  });

  test("recovers when a retry succeeds mid-schedule", async () => {
    resetServer();
    const { scheduler, captured, fireNext } = makeSyncScheduler();

    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: "agent_test",
      privateKey: makeStubJwk(),
      schedulerFn: scheduler,
    });

    try {
      await client.connect();
      expect(captured.length).toBe(1);

      // Fail the first two refresh attempts, then let the third succeed.
      state.challengeFailuresRemaining = 2;
      await fireNext(); // attempt 0 fails -> schedule retry
      await fireNext(); // attempt 1 fails -> schedule retry
      await fireNext(); // attempt 2 succeeds -> schedules next T-2min refresh

      // Healthy: not expired, and a refresh timer is queued for the next cycle.
      const flag = (client as unknown as { sessionExpired: boolean }).sessionExpired;
      expect(flag).toBe(false);
      expect(captured.length).toBeGreaterThanOrEqual(1);

      // Outgoing calls work normally.
      const agent = await client.getCurrentAgent();
      expect(agent).toBeDefined();
    } finally {
      client.disconnect();
    }
  });

  test("connect() after exhaustion clears sessionExpired", async () => {
    resetServer();
    const { scheduler, captured, fireNext } = makeSyncScheduler();

    const client = new AbadgeAgentClient({
      apiUrl,
      agentId: "agent_test",
      privateKey: makeStubJwk(),
      schedulerFn: scheduler,
    });

    try {
      await client.connect();
      state.challengeFailuresRemaining = 100;

      // Drain until exhausted.
      while (captured.length > 0) {
        await fireNext();
      }

      expect((client as unknown as { sessionExpired: boolean }).sessionExpired).toBe(true);

      // Now let connect() succeed and verify the state resets.
      state.challengeFailuresRemaining = 0;
      await client.connect();
      expect((client as unknown as { sessionExpired: boolean }).sessionExpired).toBe(false);

      const agent = await client.getCurrentAgent();
      expect(agent).toBeDefined();
    } finally {
      client.disconnect();
    }
  });
});

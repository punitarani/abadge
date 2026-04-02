import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveSessionIdentity } from "./auth";
import type { BaseRequestContext } from "./context";

function createMockContext(headers?: HeadersInit): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/vault.get", { headers }),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: {} as BaseRequestContext["db"],
    auth: {
      api: {
        getSession: async () => null,
        verifyApiKey: async () => ({ valid: false }),
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => ({
            session: { userId: "user_from_session" },
            user: null,
          }),
        },
      }),
    } as BaseRequestContext["auth"],
  };
}

describe("resolveSessionIdentity", () => {
  test("uses session.userId when getSession returns a null user", async () => {
    const ctx = createMockContext();
    ctx.auth = {
      api: {
        getSession: async () => ({
          session: { userId: "user_from_get_session" },
          user: null,
        }),
        verifyApiKey: async () => ({ valid: false }),
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => null,
        },
      }),
    } as BaseRequestContext["auth"];

    const identity = await Effect.runPromise(resolveSessionIdentity(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_from_get_session",
    });
  });

  test("falls back to session.userId when the session lookup user is null", async () => {
    const identity = await Effect.runPromise(
      resolveSessionIdentity(
        createMockContext({
          Authorization: "Bearer bearer-session-token",
        }),
      ),
    );

    expect(identity).toEqual({
      kind: "session",
      userId: "user_from_session",
    });
  });

  test("does not treat API keys as session identities", async () => {
    const ctx = createMockContext({
      Authorization: "Bearer abg_test_api_key",
    });
    ctx.auth = {
      api: {
        getSession: async () => null,
        verifyApiKey: async () => ({
          valid: true,
          key: {
            id: "principal_123",
            referenceId: "user_from_api_key",
          },
        }),
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => null,
        },
      }),
    } as BaseRequestContext["auth"];

    const error = await Effect.runPromise(Effect.flip(resolveSessionIdentity(ctx)));

    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  });
});

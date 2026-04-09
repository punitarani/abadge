import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveSessionIdentity } from "./auth";
import type { BaseRequestContext } from "./context";
import { createTrpcCallerFactory, createTrpcRouter, scopedSessionProcedure } from "./init";

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

function createOperatorTokenDb(
  record: {
    id: string;
    userId: string;
    scopes: string[];
    expiresAt: Date;
  } | null,
): BaseRequestContext["db"] {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (record ? [record] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          execute: async () => undefined,
        }),
      }),
    }),
  } as unknown as BaseRequestContext["db"];
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
      authMethod: "browser_session",
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
      authMethod: "bearer_session",
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

  test("resolves operator tokens from the dedicated header", async () => {
    const ctx = createMockContext({
      "X-Abadge-Operator-Token": "abo_test_operator_token",
    });
    ctx.db = createOperatorTokenDb({
      id: "operator_token_123",
      userId: "user_from_operator_token",
      scopes: ["items:read"],
      expiresAt: new Date(Date.now() + 60_000),
    });

    const identity = await Effect.runPromise(resolveSessionIdentity(ctx));

    expect(identity).toEqual({
      kind: "session",
      userId: "user_from_operator_token",
      authMethod: "operator_token",
      operatorTokenId: "operator_token_123",
      scopes: ["items:read"],
    });
  });

  test("rejects expired operator tokens", async () => {
    const ctx = createMockContext({
      "X-Abadge-Operator-Token": "abo_test_operator_token",
    });
    ctx.db = createOperatorTokenDb({
      id: "operator_token_123",
      userId: "user_from_operator_token",
      scopes: ["items:read"],
      expiresAt: new Date(Date.now() - 60_000),
    });

    const error = await Effect.runPromise(Effect.flip(resolveSessionIdentity(ctx)));

    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Expired operator token",
    });
  });

  test("enforces scoped procedure access for operator tokens", async () => {
    const router = createTrpcRouter({
      write: scopedSessionProcedure("items:write").query(() => ({ ok: true })),
    });
    const ctx = createMockContext({
      "X-Abadge-Operator-Token": "abo_test_operator_token",
    });
    ctx.db = createOperatorTokenDb({
      id: "operator_token_123",
      userId: "user_from_operator_token",
      scopes: ["items:read"],
      expiresAt: new Date(Date.now() + 60_000),
    });

    const caller = createTrpcCallerFactory(router)(ctx);

    await expect(caller.write()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Operator token is missing required scope: items:write",
    });
  });
});

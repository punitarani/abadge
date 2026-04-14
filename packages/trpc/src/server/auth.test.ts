import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveAgentIdentity, resolveSessionIdentity } from "./auth";
import type { BaseRequestContext } from "./context";
import { createTrpcCallerFactory, createTrpcRouter, scopedSessionProcedure } from "./init";

function createMockDb(): BaseRequestContext["db"] {
  let callCount = 0;
  const results = [[{ organizationId: "org_mock" }], [{ role: "owner" }]];
  const mockQuery = {
    from: () => mockQuery,
    where: () => mockQuery,
    limit: () => Promise.resolve(results[callCount++] ?? []),
  };
  return {
    select: () => mockQuery,
  } as unknown as BaseRequestContext["db"];
}

function createMockContext(headers?: HeadersInit): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/vault.get", { headers }),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: createMockDb(),
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
      authMethod: "browser_session",
      kind: "session",
      userId: "user_from_get_session",
      organizationId: "org_mock",
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
      organizationId: "org_mock",
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

  test("rejects legacy operator-token headers as unsupported session auth", async () => {
    const ctx = createMockContext({
      "X-Abadge-Operator-Token": "abo_test_operator_token",
    });

    const error = await Effect.runPromise(Effect.flip(resolveSessionIdentity(ctx)));

    expect(error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  });

  test("scoped session procedures still accept browser or bearer sessions", async () => {
    const router = createTrpcRouter({
      write: scopedSessionProcedure("items:write").query(() => ({ ok: true })),
    });
    const ctx = createMockContext({
      Authorization: "Bearer bearer-session-token",
    });
    const caller = createTrpcCallerFactory(router)(ctx);
    await expect(caller.write()).resolves.toEqual({ ok: true });
  });
});

function createAgentMockDb(results: unknown[][]): BaseRequestContext["db"] {
  let callCount = 0;
  const mockQuery = {
    from: () => mockQuery,
    where: () => mockQuery,
    limit: () => Promise.resolve(results[callCount++] ?? []),
  };
  const mockUpdate = {
    set: () => mockUpdate,
    where: () => mockUpdate,
    execute: () => Promise.resolve(),
  };
  return {
    select: () => mockQuery,
    update: () => mockUpdate,
  } as unknown as BaseRequestContext["db"];
}

function createAgentMockContext(options: {
  token: string;
  dbResults: unknown[][];
  verifyApiKey: BaseRequestContext["auth"]["api"]["verifyApiKey"];
}): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/items.get", {
      headers: { Authorization: `Bearer ${options.token}` },
    }),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: createAgentMockDb(options.dbResults),
    auth: {
      api: {
        getSession: async () => null,
        verifyApiKey: options.verifyApiKey,
      },
      $context: Promise.resolve({
        internalAdapter: {
          findSession: async () => null,
        },
      }),
    } as BaseRequestContext["auth"],
  };
}

describe("resolveAgentIdentity legacy API key migration", () => {
  test("rejects a valid legacy API key with no migrated agent row", async () => {
    const ctx = createAgentMockContext({
      token: "abg_legacy_key_value",
      // 1st select: verifyLocalAgentIdentity prefix lookup -> empty
      // 2nd select: verifyLegacyAgentIdentity agent-by-id lookup -> empty
      dbResults: [[], []],
      verifyApiKey: async () => ({
        valid: true,
        key: { id: "agent_orphan_123", referenceId: "user_orphan_456" },
      }),
    });

    const error = await Effect.runPromise(Effect.flip(resolveAgentIdentity(ctx)));

    expect(error).toMatchObject({
      code: "LEGACY_AGENT_UNMIGRATED",
      message: "Legacy API key has no migrated agent record",
    });
  });

  test("accepts a legacy API key with a matching migrated agent row", async () => {
    const ctx = createAgentMockContext({
      token: "abg_legacy_key_value",
      // 1st select: prefix lookup -> empty (force legacy path)
      // 2nd select: agent-by-id lookup -> one matching row
      dbResults: [
        [],
        [
          {
            id: "agent_migrated_1",
            organizationId: "org_migrated",
            createdBy: "user_migrated",
            locality: "remote",
            enabled: true,
            revokedAt: null,
          },
        ],
      ],
      verifyApiKey: async () => ({
        valid: true,
        key: { id: "agent_migrated_1", referenceId: "user_migrated" },
      }),
    });

    const identity = await Effect.runPromise(resolveAgentIdentity(ctx));

    expect(identity).toEqual({
      kind: "agent",
      agentId: "agent_migrated_1",
      agentUserId: "user_migrated",
      agentOrganizationId: "org_migrated",
      agentLocality: "remote",
    });
  });
});

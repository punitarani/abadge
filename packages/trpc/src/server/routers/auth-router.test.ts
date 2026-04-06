import { describe, expect, test } from "bun:test";
import type { BaseRequestContext } from "../context";
import { createTrpcCallerFactory } from "../init";
import { authRouter } from "./auth";

function createBaseContext(rows: unknown[]): BaseRequestContext {
  return {
    req: new Request("http://localhost/trpc/auth.createChallenge"),
    resHeaders: new Headers(),
    env: {} as BaseRequestContext["env"],
    validatedEnv: {} as BaseRequestContext["validatedEnv"],
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => rows,
          }),
        }),
      }),
    } as unknown as BaseRequestContext["db"],
    auth: {} as BaseRequestContext["auth"],
  };
}

function createAgentRow(publicKey: string | null) {
  return {
    id: "agent_123",
    userId: "user_123",
    name: "test-agent",
    kind: "local_mcp",
    locality: "local",
    authMethod: "public_key_session",
    publicKey,
    secretPrefix: null,
    enabled: true,
    revokedAt: null,
    lastUsedAt: null,
    metadata: {},
    createdAt: new Date(),
  };
}

describe("auth.createChallenge", () => {
  test("returns the same generic error when the agent is missing", async () => {
    const caller = createTrpcCallerFactory(authRouter)(createBaseContext([]));

    await expect(caller.createChallenge({ agentId: "missing-agent" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Agent challenge unavailable",
    });
  });

  test("returns the same generic error when the agent is not enrolled", async () => {
    const caller = createTrpcCallerFactory(authRouter)(createBaseContext([createAgentRow(null)]));

    await expect(caller.createChallenge({ agentId: "agent_123" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Agent challenge unavailable",
    });
  });
});

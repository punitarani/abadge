import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Bindings } from "./types";

let lastAgentCreateInput: unknown;
let lastPermissionCreateInput: unknown;
let lastAuditInput: unknown;
let callerHeaders = new Headers();

const fakeCaller = {
  agents: {
    create: async (input: unknown) => {
      lastAgentCreateInput = input;
      return {
        agent: {
          id: "agent_123",
          userId: "user_123",
          kind: "remote_agent",
          locality: "remote",
          name: "Deploy bot",
          keyPrefix: "abg_test",
          enabled: true,
          revokedAt: null,
          lastUsedAt: null,
          metadata: {},
          createdAt: "2026-04-02T00:00:00.000Z",
        },
        apiKey: "abg_secret_key",
      };
    },
    list: async () => ({ agents: [] }),
    get: async ({ agentId }: { agentId: string }) => ({
      agent: {
        id: agentId,
        userId: "user_123",
        kind: "remote_agent",
        locality: "remote",
        name: "Deploy bot",
        keyPrefix: "abg_test",
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: {},
        createdAt: "2026-04-02T00:00:00.000Z",
      },
    }),
    rotate: async () => ({ apiKey: "abg_rotated_key", keyPrefix: "abg_new" }),
    revoke: async () => ({ ok: true }),
  },
  permissions: {
    create: async (input: unknown) => {
      lastPermissionCreateInput = input;
      const { agentId, itemId, capability } = input as {
        agentId: string;
        itemId: string;
        capability: string;
      };
      return {
        permission: {
          id: "perm_123",
          agentId,
          itemId,
          capability,
          expiresAt: null,
          createdBy: "user_123",
          createdAt: "2026-04-02T00:00:00.000Z",
        },
      };
    },
    list: async () => ({ permissions: [] }),
    revoke: async () => ({ ok: true }),
  },
  audit: {
    list: async (input: unknown) => {
      lastAuditInput = input;
      return { entries: [], nextCursor: null };
    },
  },
};

mock.module("@abadge/trpc/server", () => ({
  createServerCaller: () => fakeCaller,
  createServerCallerContext: () => ({
    caller: fakeCaller,
    resHeaders: callerHeaders,
  }),
  handleTrpcRequest: () => new Response("mock trpc"),
}));

const { default: app } = await import("./index");

const testEnv: Bindings = {
  ABADGE_API_URL: "http://localhost:8787",
  ABADGE_APP_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "test-encryption-key",
  BETTER_AUTH_SECRET: "test-better-auth-secret",
};

beforeEach(() => {
  lastAgentCreateInput = undefined;
  lastPermissionCreateInput = undefined;
  lastAuditInput = undefined;
  callerHeaders = new Headers();

  fakeCaller.permissions.create = async (input: unknown) => {
    lastPermissionCreateInput = input;
    const { agentId, itemId, capability } = input as {
      agentId: string;
      itemId: string;
      capability: string;
    };
    return {
      permission: {
        id: "perm_123",
        agentId,
        itemId,
        capability,
        expiresAt: null,
        createdBy: "user_123",
        createdAt: "2026-04-02T00:00:00.000Z",
      },
    };
  };
});

describe("api app", () => {
  test("GET /health returns ok", async () => {
    const response = await app.request("http://localhost/health", undefined, testEnv);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("POST /v1/agents returns agent and apiKey", async () => {
    const response = await app.request(
      "http://localhost/v1/agents",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Deploy bot", kind: "remote_agent" }),
      },
      testEnv,
    );
    const body = (await response.json()) as {
      agent: { id: string; name: string; keyPrefix: string | null };
      apiKey: string;
    };

    expect(response.status).toBe(201);
    expect(lastAgentCreateInput).toEqual({ name: "Deploy bot", kind: "remote_agent" });
    expect(body).toMatchObject({
      agent: {
        id: "agent_123",
        name: "Deploy bot",
        keyPrefix: "abg_test",
      },
      apiKey: "abg_secret_key",
    });
  });

  test("POST /v1/permissions uses agentId and returns permission naming", async () => {
    const response = await app.request(
      "http://localhost/v1/permissions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_123",
          itemId: "item_123",
          capability: "mount_env",
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as {
      permission: { agentId: string; itemId: string; capability: string };
    };

    expect(response.status).toBe(201);
    expect(lastPermissionCreateInput).toEqual({
      agentId: "agent_123",
      itemId: "item_123",
      capability: "mount_env",
    });
    expect(body.permission.agentId).toBe("agent_123");
    expect(body.permission.itemId).toBe("item_123");
    expect(body.permission.capability).toBe("mount_env");
  });

  test("GET /v1/audit forwards agentId query parameters", async () => {
    const response = await app.request(
      "http://localhost/v1/audit?agentId=agent_123&limit=10",
      undefined,
      testEnv,
    );
    const body = (await response.json()) as { entries: unknown[]; nextCursor: string | null };

    expect(response.status).toBe(200);
    expect(lastAuditInput).toEqual({
      agentId: "agent_123",
      limit: 10,
    });
    expect(body).toEqual({ entries: [], nextCursor: null });
  });

  test("REST bridge forwards response headers from the server caller context", async () => {
    callerHeaders.set("x-abadge-test", "forwarded");

    const response = await app.request("http://localhost/v1/agents", undefined, testEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-abadge-test")).toBe("forwarded");
  });

  test("POST /v1/permissions returns renamed error messages", async () => {
    fakeCaller.permissions.create = async () => {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Agent not found",
        cause: {
          statusCode: 404,
          code: "AGENT_NOT_FOUND",
        },
      });
    };

    const response = await app.request(
      "http://localhost/v1/permissions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "missing_agent",
          itemId: "item_123",
          capability: "mount_env",
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { error: string; code?: string };

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "Agent not found",
      code: "AGENT_NOT_FOUND",
    });
  });
});

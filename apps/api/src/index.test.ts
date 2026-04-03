import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import type { Bindings } from "./types";

let lastAgentCreateInput: unknown;
let lastPermissionCreateInput: unknown;
let lastAuditInput: unknown;
let lastVaultBootstrapInput: unknown;
let lastVaultChangePasswordInput: unknown;
let lastVaultRecoveryInput: unknown;
let lastVaultRotateKeyInput: unknown;
let lastItemCreateInput: unknown;
let lastItemGetInput: unknown;
let lastItemUpdateInput: unknown;
let lastItemDeleteInput: unknown;
let lastAccessCiphertextInput: unknown;
let lastAccessRevealInput: unknown;
let lastAccessMountInput: unknown;
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
  vault: {
    bootstrap: async (input: unknown) => {
      lastVaultBootstrapInput = input;
      return { id: "vault_123" };
    },
    get: async () => ({
      vault: {
        id: "vault_123",
        userId: "user_123",
        wrappedRootKey: "wrapped_key_data",
        kdfSalt: "salt_data",
        kdfParams: {
          algorithm: "argon2id",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
          hashLength: 32,
        },
        recoveryWrappedRootKey: null,
        keyVersion: 1,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    }),
    changePassword: async (input: unknown) => {
      lastVaultChangePasswordInput = input;
      return { ok: true };
    },
    setupRecovery: async (input: unknown) => {
      lastVaultRecoveryInput = input;
      return { ok: true };
    },
    rotateKey: async (input: unknown) => {
      lastVaultRotateKeyInput = input;
      return { ok: true, keyVersion: 2 };
    },
  },
  items: {
    create: async (input: unknown) => {
      lastItemCreateInput = input;
      return { id: "item_123" };
    },
    list: async () => ({
      items: [
        {
          id: "item_123",
          storageMode: "server_managed",
          cryptoVersion: 1,
          contentVersion: 1,
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z",
        },
      ],
    }),
    get: async (input: unknown) => {
      lastItemGetInput = input;
      const { itemId } = input as { itemId: string };
      return {
        item: {
          id: itemId,
          storageMode: "server_managed",
          cryptoVersion: 1,
          contentVersion: 1,
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:00:00.000Z",
        },
      };
    },
    update: async (input: unknown) => {
      lastItemUpdateInput = input;
      return { ok: true, contentVersion: 2 };
    },
    delete: async (input: unknown) => {
      lastItemDeleteInput = input;
      return { ok: true };
    },
  },
  access: {
    ciphertext: async (input: unknown) => {
      lastAccessCiphertextInput = input;
      return {
        encryptedItemKey: "encrypted_key",
        ciphertext: "encrypted_data",
        cryptoVersion: 1,
      };
    },
    reveal: async (input: unknown) => {
      lastAccessRevealInput = input;
      return {
        payload: {
          v: 1,
          label: "my-secret",
          kind: "opaque",
          tags: [],
          fields: { value: "secret_value" },
        },
      };
    },
    mount: async (input: unknown) => {
      lastAccessMountInput = input;
      return {
        storageMode: "server_managed",
        payload: {
          v: 1,
          label: "my-secret",
          kind: "opaque",
          tags: [],
          fields: { value: "secret_value" },
        },
      };
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
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  GITHUB_CLIENT_ID: "test-github-client-id",
  GITHUB_CLIENT_SECRET: "test-github-client-secret",
};

beforeEach(() => {
  lastAgentCreateInput = undefined;
  lastPermissionCreateInput = undefined;
  lastAuditInput = undefined;
  lastVaultBootstrapInput = undefined;
  lastVaultChangePasswordInput = undefined;
  lastVaultRecoveryInput = undefined;
  lastVaultRotateKeyInput = undefined;
  lastItemCreateInput = undefined;
  lastItemGetInput = undefined;
  lastItemUpdateInput = undefined;
  lastItemDeleteInput = undefined;
  lastAccessCiphertextInput = undefined;
  lastAccessRevealInput = undefined;
  lastAccessMountInput = undefined;
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

describe("vault routes", () => {
  test("POST /v1/vault/bootstrap forwards body and returns 201", async () => {
    const response = await app.request(
      "http://localhost/v1/vault/bootstrap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wrappedRootKey: "wrapped_key",
          kdfSalt: "salt",
          kdfParams: {
            algorithm: "argon2id",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
            hashLength: 32,
          },
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { id: string };

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: "vault_123" });
    expect(lastVaultBootstrapInput).toEqual({
      wrappedRootKey: "wrapped_key",
      kdfSalt: "salt",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });
  });

  test("GET /v1/vault returns vault metadata", async () => {
    const response = await app.request("http://localhost/v1/vault", undefined, testEnv);
    const body = (await response.json()) as { vault: { id: string } };

    expect(response.status).toBe(200);
    expect(body.vault.id).toBe("vault_123");
    expect(body.vault).toHaveProperty("wrappedRootKey");
    expect(body.vault).toHaveProperty("kdfSalt");
  });

  test("POST /v1/vault/change-password forwards body", async () => {
    const response = await app.request(
      "http://localhost/v1/vault/change-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wrappedRootKey: "new_wrapped_key",
          kdfSalt: "new_salt",
          kdfParams: {
            algorithm: "argon2id",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
            hashLength: 32,
          },
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(lastVaultChangePasswordInput).toEqual({
      wrappedRootKey: "new_wrapped_key",
      kdfSalt: "new_salt",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });
  });

  test("POST /v1/vault/recovery forwards body", async () => {
    const response = await app.request(
      "http://localhost/v1/vault/recovery",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryWrappedRootKey: "recovery_wrapped" }),
      },
      testEnv,
    );
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(lastVaultRecoveryInput).toEqual({ recoveryWrappedRootKey: "recovery_wrapped" });
  });

  test("POST /v1/vault/rotate-key forwards body and returns keyVersion", async () => {
    const response = await app.request(
      "http://localhost/v1/vault/rotate-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wrappedRootKey: "rotated_key",
          rekeyedItems: { item_1: "new_enc_key_1" },
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { ok: boolean; keyVersion: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, keyVersion: 2 });
    expect(lastVaultRotateKeyInput).toEqual({
      wrappedRootKey: "rotated_key",
      rekeyedItems: { item_1: "new_enc_key_1" },
    });
  });

  test("POST /v1/vault/bootstrap returns 409 on conflict", async () => {
    fakeCaller.vault.bootstrap = async () => {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Vault already exists",
        cause: { statusCode: 409, code: "VAULT_ALREADY_EXISTS" },
      });
    };

    const response = await app.request(
      "http://localhost/v1/vault/bootstrap",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wrappedRootKey: "x",
          kdfSalt: "x",
          kdfParams: {
            algorithm: "argon2id",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
            hashLength: 32,
          },
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("VAULT_ALREADY_EXISTS");
  });
});

describe("item routes", () => {
  test("POST /v1/items creates item and returns 201", async () => {
    const response = await app.request(
      "http://localhost/v1/items",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageMode: "server_managed",
          payload: {
            v: 1,
            label: "my-secret",
            kind: "opaque",
            tags: [],
            fields: { value: "secret" },
          },
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { id: string };

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: "item_123" });
    expect(lastItemCreateInput).toEqual({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "my-secret",
        kind: "opaque",
        tags: [],
        fields: { value: "secret" },
      },
    });
  });

  test("GET /v1/items lists items", async () => {
    const response = await app.request("http://localhost/v1/items", undefined, testEnv);
    const body = (await response.json()) as { items: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe("item_123");
  });

  test("GET /v1/items/:itemId returns single item", async () => {
    const response = await app.request("http://localhost/v1/items/item_456", undefined, testEnv);
    const body = (await response.json()) as { item: { id: string } };

    expect(response.status).toBe(200);
    expect(body.item.id).toBe("item_456");
    expect(lastItemGetInput).toEqual({ itemId: "item_456" });
  });

  test("PUT /v1/items/:itemId updates item", async () => {
    const response = await app.request(
      "http://localhost/v1/items/item_456",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageMode: "server_managed",
          payload: {
            v: 1,
            label: "updated",
            kind: "opaque",
            tags: [],
            fields: { value: "new_value" },
          },
          contentVersion: 1,
        }),
      },
      testEnv,
    );
    const body = (await response.json()) as { ok: boolean; contentVersion: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, contentVersion: 2 });
    expect(lastItemUpdateInput).toEqual({
      itemId: "item_456",
      data: {
        storageMode: "server_managed",
        payload: {
          v: 1,
          label: "updated",
          kind: "opaque",
          tags: [],
          fields: { value: "new_value" },
        },
        contentVersion: 1,
      },
    });
  });

  test("DELETE /v1/items/:itemId deletes item", async () => {
    const response = await app.request(
      "http://localhost/v1/items/item_456",
      { method: "DELETE" },
      testEnv,
    );
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(lastItemDeleteInput).toEqual({ itemId: "item_456" });
  });
});

describe("access routes", () => {
  test("POST /v1/access/ciphertext returns encrypted blob", async () => {
    const response = await app.request(
      "http://localhost/v1/access/ciphertext",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer abl_test_key",
        },
        body: JSON.stringify({ itemId: "item_123" }),
      },
      testEnv,
    );
    const body = (await response.json()) as {
      encryptedItemKey: string;
      ciphertext: string;
      cryptoVersion: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      encryptedItemKey: "encrypted_key",
      ciphertext: "encrypted_data",
      cryptoVersion: 1,
    });
    expect(lastAccessCiphertextInput).toEqual({ itemId: "item_123" });
  });

  test("POST /v1/access/reveal returns decrypted payload", async () => {
    const response = await app.request(
      "http://localhost/v1/access/reveal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer abg_test_key",
        },
        body: JSON.stringify({ itemId: "item_123" }),
      },
      testEnv,
    );
    const body = (await response.json()) as {
      payload: { v: number; label: string; kind: string };
    };

    expect(response.status).toBe(200);
    expect(body.payload.label).toBe("my-secret");
    expect(body.payload.kind).toBe("opaque");
    expect(lastAccessRevealInput).toEqual({ itemId: "item_123" });
  });

  test("POST /v1/access/mount returns mount data", async () => {
    const response = await app.request(
      "http://localhost/v1/access/mount",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer abl_test_key",
        },
        body: JSON.stringify({ itemId: "item_123", mountType: "env" }),
      },
      testEnv,
    );
    const body = (await response.json()) as {
      storageMode: string;
      payload: { label: string };
    };

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe("server_managed");
    expect(body.payload.label).toBe("my-secret");
    expect(lastAccessMountInput).toEqual({ itemId: "item_123", mountType: "env" });
  });

  test("POST /v1/access/reveal returns 403 on permission denied", async () => {
    fakeCaller.access.reveal = async () => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No valid permission",
        cause: { statusCode: 403, code: "PERMISSION_DENIED" },
      });
    };

    const response = await app.request(
      "http://localhost/v1/access/reveal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer abg_test_key",
        },
        body: JSON.stringify({ itemId: "item_no_perm" }),
      },
      testEnv,
    );
    const body = (await response.json()) as { error: string; code: string };

    expect(response.status).toBe(403);
    expect(body.code).toBe("PERMISSION_DENIED");
  });
});

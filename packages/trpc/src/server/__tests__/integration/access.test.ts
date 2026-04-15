import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "@abadge/db";
import { and, eq } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";
import type { AppBindings, BaseRequestContext } from "../../context";
import { createTrpcCallerFactory } from "../../init";
import { appRouter } from "../../router";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
  seedZkItem,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

describe("access", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("access.reveal returns decrypted payload for authorized agent", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { api_key: "sk-12345", endpoint: "https://api.example.com" },
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.reveal({ itemId: item.itemId });
    expect(result.payload.fields.api_key).toBe("sk-12345");
  });

  test("access.reveal with field parameter returns only that field", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    // Use default fields (username, password) so "password" exists
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.reveal({ itemId: item.itemId, field: "password" });
    expect(result.payload.fields.password).toBeDefined();
    expect(Object.keys(result.payload.fields).length).toBe(1);
  });

  test("access.reveal denied without permission", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    try {
      await agentCaller.access.reveal({ itemId: item.itemId });
      expect.unreachable("reveal without permission should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("access.reveal denied with expired permission", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Seed an already-expired permission
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    try {
      await agentCaller.access.reveal({ itemId: item.itemId });
      expect.unreachable("reveal with expired permission should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("access.ciphertext for local agent with ZK item", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const item = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "read_ciphertext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.ciphertext({ itemId: item.itemId });
    expect(result.ciphertext).toBeTruthy();
    expect(result.encryptedItemKey).toBeTruthy();
  });

  test("access.ciphertext denied for remote agent", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const item = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Seed permission directly to bypass capability matrix check
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "read_ciphertext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    try {
      await agentCaller.access.ciphertext({ itemId: item.itemId });
      expect.unreachable("remote agent accessing ciphertext should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("cross-org access is impossible", async () => {
    // Org 1: item lives here
    const owner1 = await seedUser(auth);
    const org1 = await seedOrg(auth, owner1.userId);
    const item = await seedServerItem(db, {
      userId: owner1.userId,
      orgId: org1.orgId,
    });

    // Org 2: agent lives here
    const owner2 = await seedUser(auth);
    const org2 = await seedOrg(auth, owner2.userId);
    const agent = await seedAgent(db, {
      userId: owner2.userId,
      orgId: org2.orgId,
      kind: "remote",
    });

    // Seed a permission record directly pointing across orgs
    await seedPermission(db, {
      orgId: org2.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner2.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner2.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // The access router's loadAccessibleItem checks eq(items.organizationId, agentOrganizationId)
    // so the item from org1 is invisible to the org2 agent
    try {
      await agentCaller.access.reveal({ itemId: item.itemId });
      expect.unreachable("cross-org access should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("NOT_FOUND");
    }
  });

  describe("access.reveal field resolution errors", () => {
    test("returns FIELD_NOT_FOUND with hint + availableFields when field doesn't exist", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        fields: { username: "admin", password: "s3cret" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "remote",
      });

      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "reveal_plaintext",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      try {
        await agentCaller.access.reveal({ itemId: item.itemId, field: "totp_secret" });
        expect.unreachable("reveal with unknown field should have thrown");
      } catch (error: unknown) {
        const trpcError = error as {
          code?: string;
          cause?: { code?: string; hint?: string; meta?: { availableFields?: string[] } };
        };
        expect(trpcError.code).toBe("BAD_REQUEST");
        expect(trpcError.cause?.code).toBe("FIELD_NOT_FOUND");
        expect(trpcError.cause?.hint ?? "").toMatch(/Available fields/);
        const availableFields = trpcError.cause?.meta?.availableFields ?? [];
        expect(availableFields).toContain("username");
        expect(availableFields).toContain("password");
      }
    });

    test("writes a denied audit row on FIELD_NOT_FOUND", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        fields: { username: "admin", password: "s3cret" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "remote",
      });

      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "reveal_plaintext",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      await expect(
        agentCaller.access.reveal({ itemId: item.itemId, field: "nope" }),
      ).rejects.toBeDefined();

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.agentId, agent.agentId),
            eq(auditLogs.itemId, item.itemId),
            eq(auditLogs.eventType, "access.reveal"),
            eq(auditLogs.result, "denied"),
          ),
        );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const meta = rows[0]?.meta as { reason?: string; availableFields?: string[] } | null;
      expect(meta?.reason).toBe("FieldNotFoundError");
      expect(meta?.availableFields ?? []).toContain("username");
    });
  });

  describe("access.mount field resolution errors", () => {
    test("returns FIELD_NOT_FOUND for mount_env when field doesn't exist", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        fields: { username: "admin", password: "s3cret" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });

      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      try {
        await agentCaller.access.mount({
          itemId: item.itemId,
          mountType: "env",
          field: "totp_secret",
        });
        expect.unreachable("mount_env with unknown field should have thrown");
      } catch (error: unknown) {
        const trpcError = error as {
          code?: string;
          cause?: { code?: string; meta?: { availableFields?: string[] } };
        };
        expect(trpcError.cause?.code).toBe("FIELD_NOT_FOUND");
        const availableFields = trpcError.cause?.meta?.availableFields ?? [];
        expect(availableFields).toContain("username");
      }
    });

    test("writes a denied audit row for access.mount_env on field failure", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        fields: { username: "admin", password: "s3cret" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });

      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      await expect(
        agentCaller.access.mount({
          itemId: item.itemId,
          mountType: "env",
          field: "ghost",
        }),
      ).rejects.toBeDefined();

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.agentId, agent.agentId),
            eq(auditLogs.itemId, item.itemId),
            eq(auditLogs.eventType, "access.mount_env"),
            eq(auditLogs.result, "denied"),
          ),
        );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const meta = rows[0]?.meta as { reason?: string } | null;
      expect(meta?.reason).toBe("FieldNotFoundError");
    });
  });

  describe("audit-write failure does not mask domain error", () => {
    test("FIELD_NOT_FOUND is preserved even if the denied audit insert throws", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        fields: { username: "admin", password: "s3cret" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "remote",
      });

      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "reveal_plaintext",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });

      // Wrap db so that any insert into auditLogs throws. All other inserts
      // and selects pass through unchanged, so bearer-token auth and item
      // lookup still work.
      const hijackedDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "insert") {
            return (table: unknown) => {
              if (table === auditLogs) {
                throw new Error("simulated audit-log insert failure");
              }
              return (target as unknown as Database).insert(table as never);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as Database;

      const headers = new Headers();
      headers.set("authorization", `Bearer ${session.rawToken}`);
      const ctx: BaseRequestContext = {
        req: new Request("http://test", { headers }),
        resHeaders: new Headers(),
        env: { ...TEST_ENV } as AppBindings,
        validatedEnv: TEST_ENV,
        db: hijackedDb,
        auth,
        ipAddress: "127.0.0.1",
      };
      const hijackedCaller = createTrpcCallerFactory(appRouter)(ctx);

      // The denied-audit write inside tapError will throw; the helper's
      // Effect.catchAll(() => Effect.void) must swallow that and let the
      // original FIELD_NOT_FOUND propagate to the client.
      try {
        await hijackedCaller.access.reveal({ itemId: item.itemId, field: "totp_secret" });
        expect.unreachable("reveal with unknown field should have thrown");
      } catch (error: unknown) {
        const trpcError = error as {
          code?: string;
          cause?: { code?: string; meta?: { availableFields?: string[] } };
        };
        // Must be FIELD_NOT_FOUND — NOT the audit-write DB error.
        expect(trpcError.cause?.code).toBe("FIELD_NOT_FOUND");
        const availableFields = trpcError.cause?.meta?.availableFields ?? [];
        expect(availableFields).toContain("username");
      }
    });
  });
});

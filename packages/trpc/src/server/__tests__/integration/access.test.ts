import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { BulkMountEnvItem } from "@abadge/core";
import type { Database } from "@abadge/db";
import { and, eq } from "@abadge/db";
import { auditLogs, items } from "@abadge/db/schema";
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

  describe("access.bulkMountEnv", () => {
    test("returns only items in the input profile that the agent has mount_env on", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);

      const profileA = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
      const profileB = await seedProfile(db, org.orgId, { storageMode: "server_managed" });

      // Two items in profile A: one granted, one not.
      const grantedA = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profileA.profileId,
        label: "openai-key",
        fields: { value: "sk-A" },
      });
      const ungranted = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profileA.profileId,
        fields: { value: "should-not-appear" },
      });

      // One item in profile B that the agent DOES have mount_env on — must
      // NOT come back when scoping to profile A. Profile is the trust boundary.
      const grantedB = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profileB.profileId,
        label: "redis-url",
        fields: { value: "redis://b" },
      });

      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: grantedA.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: grantedB.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      const result = await agentCaller.access.bulkMountEnv({ profileId: profileA.profileId });
      const items = result.items as ReadonlyArray<BulkMountEnvItem>;
      const ids = items.map((i) => i.itemId).sort();
      expect(ids).toEqual([grantedA.itemId].sort());
      expect(ids).not.toContain(ungranted.itemId);
      expect(ids).not.toContain(grantedB.itemId);
    });

    test("excludes items granted only read_ciphertext (capability filter)", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profile.profileId,
        fields: { value: "x" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });
      // ZK-style read capability — not mount_env. ZK items aren't even
      // applicable here but the capability filter still applies generally.
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

      const result = await agentCaller.access.bulkMountEnv({ profileId: profile.profileId });
      expect(result.items).toEqual([]);
    });

    test("excludes items where the mount_env permission has expired", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });

      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profile.profileId,
        fields: { value: "stale" },
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
        expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
      });
      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      const result = await agentCaller.access.bulkMountEnv({ profileId: profile.profileId });
      expect(result.items).toEqual([]);
    });

    test("rejects remote agents at the gate with PERMISSION_DENIED", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
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
        await agentCaller.access.bulkMountEnv({ profileId: profile.profileId });
        throw new Error("Expected bulkMountEnv to reject remote agent");
      } catch (error) {
        const trpcError = error as { cause?: { code?: string } };
        expect(trpcError.cause?.code).toBe("PERMISSION_DENIED");
      }
    });

    test("returns PROFILE_NOT_FOUND for a profileId in another org (no existence leak)", async () => {
      const owner = await seedUser(auth);
      const org1 = await seedOrg(auth, owner.userId);
      const org2 = await seedOrg(auth, owner.userId);
      const otherProfile = await seedProfile(db, org2.orgId, { storageMode: "server_managed" });

      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org1.orgId,
        kind: "local_cli",
      });
      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      try {
        await agentCaller.access.bulkMountEnv({ profileId: otherProfile.profileId });
        throw new Error("Expected bulkMountEnv to reject cross-org profile lookup");
      } catch (error) {
        const trpcError = error as { cause?: { code?: string } };
        expect(trpcError.cause?.code).toBe("PROFILE_NOT_FOUND");
      }
    });

    test("writes one access.mount_env audit row per included item with meta.viaBulk = true", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });

      const item1 = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profile.profileId,
        label: "key1",
        fields: { value: "v1" },
      });
      const item2 = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profile.profileId,
        label: "key2",
        fields: { value: "v2" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item1.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item2.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      await agentCaller.access.bulkMountEnv({ profileId: profile.profileId });

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.eventType, "access.mount_env"), eq(auditLogs.agentId, agent.agentId)),
        );
      expect(rows.length).toBe(2);
      for (const r of rows) {
        const meta = (r.meta as { viaBulk?: boolean } | null) ?? {};
        expect(meta.viaBulk).toBe(true);
        expect(r.profileId).toBe(profile.profileId);
        expect(r.result).toBe("allowed");
      }
    });

    test("does NOT write phantom 'allowed' audit rows when a later item fails (Greptile P1)", async () => {
      // Regression for Greptile P1: if the bulk loop wrote audit rows
      // inline, the earlier ZK items would leave "allowed" rows when a
      // later item triggered IntegrityError mid-loop, claiming successful
      // delivery for items the agent never received. The staging fix
      // discards those rows when Effect.fail short-circuits.
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });

      const goodZk = await seedZkItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profile.profileId,
        label: "good-zk",
      });
      const corruptZk = await seedZkItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: profile.profileId,
        label: "corrupt-zk",
      });
      // Force one item into the corrupt-envelope branch that bulkMountEnv
      // hard-fails on. encryptedItemKey is nullable in the schema, so
      // clearing it leaves the row visible to the JOIN (still has profileId
      // and a permission row) but the bulk loop's integrity check rejects
      // it mid-iteration. This is the exact crash window the staging fix
      // is supposed to protect against.
      await db.update(items).set({ encryptedItemKey: null }).where(eq(items.id, corruptZk.itemId));

      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: goodZk.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: corruptZk.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      try {
        await agentCaller.access.bulkMountEnv({ profileId: profile.profileId });
        throw new Error("expected bulk call to fail on corrupt item");
      } catch (error) {
        const trpcError = error as { cause?: { code?: string } };
        expect(trpcError.cause?.code).toBe("INTEGRITY_ERROR");
      }

      // Audit invariant: ZERO "allowed" rows should exist for either item.
      // The corrupt item should have one "denied" row (factually correct);
      // the good item should have NO audit row at all (its staged "allowed"
      // was discarded when the integrity error short-circuited the gen).
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.eventType, "access.mount_env"), eq(auditLogs.agentId, agent.agentId)),
        );
      const allowed = rows.filter((r) => r.result === "allowed");
      const denied = rows.filter((r) => r.result === "denied");
      expect(allowed.length).toBe(0);
      expect(denied.length).toBe(1);
      expect(denied[0]?.itemId).toBe(corruptZk.itemId);
    });

    test("returns mixed ZK + server-managed items in one response", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const zkProfile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });

      const zkItem = await seedZkItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: zkProfile.profileId,
        label: "zk-secret",
      });
      // server-managed items can also live alongside ZK items in a profile
      // (profile.storageMode is the "default" — items can override). Seed one
      // here and grant mount_env on both.
      const smItem = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        profileId: zkProfile.profileId,
        label: "sm-secret",
        fields: { value: "v-sm" },
      });
      const agent = await seedAgent(db, {
        userId: owner.userId,
        orgId: org.orgId,
        kind: "local_cli",
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: zkItem.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: smItem.itemId,
        capability: "mount_env",
        grantedBy: owner.userId,
      });
      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });
      const agentCaller = createAgentCaller(db, auth, session.rawToken);

      const result = await agentCaller.access.bulkMountEnv({ profileId: zkProfile.profileId });
      expect(result.items.length).toBe(2);
      // strictSchema's output type collapses unions into `{}` at the trpc-caller
      // boundary; the runtime shape matches BulkMountEnvItem so we re-narrow here.
      const items = result.items as ReadonlyArray<BulkMountEnvItem>;
      const byId = new Map(items.map((i) => [i.itemId, i]));
      const zk = byId.get(zkItem.itemId);
      const sm = byId.get(smItem.itemId);
      expect(zk?.storageMode).toBe("zero_knowledge");
      expect(sm?.storageMode).toBe("server_managed");
      if (zk?.storageMode === "zero_knowledge") {
        // ZK envelope passes through to the daemon for in-process decryption.
        expect(zk.encryptedItemKey).toBeTruthy();
        expect(zk.ciphertext).toBeTruthy();
        expect(zk.profileId).toBe(zkProfile.profileId);
      }
      if (sm?.storageMode === "server_managed") {
        expect(sm.payload.fields.value).toBe("v-sm");
      }
    });
  });
});

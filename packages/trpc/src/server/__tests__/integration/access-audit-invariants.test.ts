import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { toBase64 } from "@abadge/crypto/shared";
import { and, type Database, eq, type Transaction } from "@abadge/db";
import { auditLogs, items as itemRecords, mountReservations } from "@abadge/db/schema";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * Access-pipeline audit invariants (AB-0022)
 *
 * Pins the access pipeline's strongest properties so a future refactor can't
 * silently drop them:
 *  - every denied/expired access is audited BEFORE the error is raised, and
 *  - a granted mount reservation and its "allowed" audit row are written in
 *    one transaction (an audit-insert failure rolls back the reservation).
 */
describe("access pipeline audit invariants (AB-0022)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  async function seedAgentForAccess(orgId: string, userId: string) {
    const agent = await seedAgent(db, { userId, orgId, kind: "local_cli" });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId });
    return { agent, caller: createAgentCaller(db, auth, session.rawToken) };
  }

  test("a denied read (no permission) writes one denied audit row and no mount reservation", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const { agent, caller } = await seedAgentForAccess(org.orgId, owner.userId);

    await expect(caller.access.read({ itemId: item.itemId })).rejects.toThrow();

    const audits = await db
      .select({ result: auditLogs.result, eventType: auditLogs.eventType })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.itemId, item.itemId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe("denied");
    expect(audits[0]?.eventType).toBe("access.reveal");

    const reservations = await db
      .select({ id: mountReservations.id })
      .from(mountReservations)
      .where(eq(mountReservations.agentId, agent.agentId));
    expect(reservations).toHaveLength(0);
  });

  test("an allowed use writes one allowed audit row and one mount reservation", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const { agent, caller } = await seedAgentForAccess(org.orgId, owner.userId);
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "mount_env",
      grantedBy: owner.userId,
    });

    const result = await caller.access.use({ itemId: item.itemId, delivery: "env" });
    expect(result.mountId).toBeTruthy();

    const allowed = await db
      .select({ result: auditLogs.result })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.result, "allowed")));
    expect(allowed).toHaveLength(1);

    const reservations = await db
      .select({ mountId: mountReservations.mountId })
      .from(mountReservations)
      .where(eq(mountReservations.agentId, agent.agentId));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.mountId).toBe(result.mountId);
  });

  test("an audit-insert failure rolls back the mount reservation (zero reservations, zero audit rows)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: owner.userId });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "mount_env",
      grantedBy: owner.userId,
    });

    // Throw only on `tx.insert(auditLogs)`; the reservation insert earlier in
    // the same tx must roll back with it. The pipeline runs both writes on `tx`
    // (not `ctx.db`), and agent auth uses selects + a lastUsedAt update, so the
    // auth path is untouched by this Proxy.
    const hijackedDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (cb: (tx: unknown) => Promise<unknown>) =>
            (target as Database).transaction((tx: Transaction) => {
              const hijackedTx = new Proxy(tx as object, {
                get(t2, p2, r2) {
                  if (p2 === "insert") {
                    return (table: unknown) => {
                      if (table === auditLogs) {
                        throw new Error("simulated audit insert failure");
                      }
                      return (t2 as { insert: (t: unknown) => unknown }).insert(table);
                    };
                  }
                  return Reflect.get(t2, p2, r2);
                },
              });
              return cb(hijackedTx);
            });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Database;
    const caller = createAgentCaller(hijackedDb, auth, session.rawToken);

    await expect(caller.access.use({ itemId: item.itemId, delivery: "env" })).rejects.toThrow();

    const reservations = await db
      .select({ id: mountReservations.id })
      .from(mountReservations)
      .where(eq(mountReservations.agentId, agent.agentId));
    expect(reservations).toHaveLength(0);

    // The whole tx rolls back, so NO audit row survives — not just the
    // "allowed" one. A compensating row written outside the tx would trip this.
    const audits = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.agentId, agent.agentId));
    expect(audits).toHaveLength(0);
  });

  test("corrupt ciphertext on authorized server_managed read writes denied audit row", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const { agent, caller } = await seedAgentForAccess(org.orgId, owner.userId);
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    // Overwrite ciphertext with random bytes so AES-GCM decryption fails at the
    // crypto layer — the permission is valid, so the audit row must still appear.
    await db
      .update(itemRecords)
      .set({ serverCiphertext: toBase64(new Uint8Array(48)) })
      .where(eq(itemRecords.id, item.itemId));

    await expect(caller.access.read({ itemId: item.itemId })).rejects.toThrow();

    const audits = await db
      .select({ result: auditLogs.result, eventType: auditLogs.eventType, meta: auditLogs.meta })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.itemId, item.itemId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe("denied");
    expect(audits[0]?.eventType).toBe("access.reveal");
    const meta = audits[0]?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("decrypt_failed");
  });

  test("corrupt ciphertext on mount redeem writes a denied audit row (decrypt_failed)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const { agent, caller } = await seedAgentForAccess(org.orgId, owner.userId);
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "mount_env",
      grantedBy: owner.userId,
    });

    // Mint a mount handle while the ciphertext is still valid (writes an "allowed" row).
    const { mountId } = await caller.access.use({ itemId: item.itemId, delivery: "env" });
    expect(mountId).toBeTruthy();

    // Corrupt the ciphertext, then redeem. Decryption fails at the crypto layer but
    // the access was authorized, so §AB-0022 requires a denied audit row on the
    // redeem path too — not just the access.read pipeline.
    await db
      .update(itemRecords)
      .set({ serverCiphertext: toBase64(new Uint8Array(48)) })
      .where(eq(itemRecords.id, item.itemId));

    await expect(caller.access.redeemMount({ mountId })).rejects.toThrow();

    const denied = await db
      .select({ result: auditLogs.result, meta: auditLogs.meta })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.result, "denied")));
    expect(denied).toHaveLength(1);
    const meta = denied[0]?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("decrypt_failed");
    expect(meta?.via).toBe("mount_redeem");
  });

  test("an expired permission writes a result='expired' audit row", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const { agent, caller } = await seedAgentForAccess(org.orgId, owner.userId);
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(caller.access.read({ itemId: item.itemId })).rejects.toThrow();

    const audits = await db
      .select({ result: auditLogs.result, eventType: auditLogs.eventType })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.itemId, item.itemId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe("expired");
    expect(audits[0]?.eventType).toBe("access.reveal");
  });
});

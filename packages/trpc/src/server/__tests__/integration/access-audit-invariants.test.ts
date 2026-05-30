import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, type Database, eq } from "@abadge/db";
import { auditLogs, mountReservations } from "@abadge/db/schema";
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
 * Access-pipeline audit invariants
 *
 * Pins the access pipeline's strongest properties so a future refactor can't
 * silently drop them:
 *  - every denied/expired access is audited BEFORE the error is raised, and
 *  - a granted mount reservation and its "allowed" audit row are written in
 *    one transaction (an audit-insert failure rolls back the reservation).
 */
describe("access pipeline audit invariants", () => {
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

    // Throw only on `insert(auditLogs)`; the reservation insert in the same
    // (sub)transaction must roll back with it. The GUC middleware
    // opens the request transaction and the pipeline's reservation+audit writes
    // run in a nested SAVEPOINT of it, so the hijack must recurse into nested
    // `.transaction()` calls — otherwise the savepoint would get a non-hijacked tx
    // and the simulated failure would never fire. Agent auth uses selects + a
    // lastUsedAt update before the tx, so the auth path is untouched.
    const hijackTx = (txLike: object): unknown =>
      new Proxy(txLike, {
        get(t, p, r) {
          if (p === "insert") {
            return (table: unknown) => {
              if (table === auditLogs) {
                throw new Error("simulated audit insert failure");
              }
              return (t as { insert: (x: unknown) => unknown }).insert(table);
            };
          }
          if (p === "transaction") {
            return (cb: (tx: unknown) => Promise<unknown>) =>
              (t as { transaction: (f: (x: unknown) => unknown) => unknown }).transaction((inner) =>
                cb(hijackTx(inner as object)),
              );
          }
          return Reflect.get(t, p, r);
        },
      });
    const hijackedDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (cb: (tx: unknown) => Promise<unknown>) =>
            (target as Database).transaction((tx) => cb(hijackTx(tx as object)));
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

    // The savepoint holding the reservation + audit writes rolls back, so NO
    // audit row survives — not just the "allowed" one. A compensating row written
    // outside that transaction would trip this.
    const audits = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(eq(auditLogs.agentId, agent.agentId));
    expect(audits).toHaveLength(0);
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

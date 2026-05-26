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
 * §AB-0022 — pin the access pipeline's strongest properties so a future
 * refactor can't silently drop them:
 *  - every denied/expired access is audited BEFORE the error is raised, and
 *  - a granted mount reservation and its "allowed" audit row are written in
 *    one transaction (audit-insert failure rolls back the reservation).
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

  // AB-0022 #1 — denied read writes exactly one denied audit row, no reservation.
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

    const reservations = await db
      .select({ id: mountReservations.id })
      .from(mountReservations)
      .where(eq(mountReservations.agentId, agent.agentId));
    expect(reservations).toHaveLength(0);
  });

  // AB-0022 #2 — allowed use writes one allowed audit row and one reservation.
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

  // AB-0022 #3 — a forced audit-insert failure inside the mount transaction
  // rolls back BOTH the reservation and the audit row (atomicity). The fault is
  // injected on the transaction's `tx.insert(auditLogs)` (the pipeline uses tx,
  // not ctx.db, inside the reservation+audit transaction).
  test("an audit-insert failure rolls back the mount reservation (zero reservations, zero allowed audits)", async () => {
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

    // Hijack the transaction so the audit insert throws; the reservation insert
    // (earlier in the same tx) must roll back with it. Agent auth (selects +
    // lastUsedAt update) is untouched.
    const hijackedDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (cb: (tx: unknown) => unknown) =>
            (target as Database).transaction((tx) => {
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

    const allowed = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.result, "allowed")));
    expect(allowed).toHaveLength(0);
  });

  // AB-0022 #4 — an expired permission writes a result='expired' audit row.
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
      expiresAt: new Date(Date.now() - 60_000), // expired one minute ago
    });

    await expect(caller.access.read({ itemId: item.itemId })).rejects.toThrow();

    const audits = await db
      .select({ result: auditLogs.result })
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.itemId, item.itemId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe("expired");
  });
});

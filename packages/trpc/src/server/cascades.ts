import type { Transaction } from "@abadge/db";
import { and, eq, gt, isNull } from "@abadge/db";
import { agentSessions, auditLogs, permissions } from "@abadge/db/schema";

// Re-export so callers (tRPC routers, tests) can import from one place.
export { onMemberRemoved } from "@abadge/db";

/**
 * Cascade helpers.
 *
 * Every `on*` helper here requires an already-open transaction (Drizzle
 * `Transaction`). The caller is responsible for opening the outer
 * `ctx.db.transaction(async (tx) => { ... })` so the primary mutation
 * (agent revoke, item soft-delete, member remove) AND the cascade's
 * side-effect writes all land atomically. Callers that only need the
 * cascade (e.g. test harnesses) can wrap themselves:
 *     await db.transaction((tx) => onMemberRemoved(tx, ...));
 */

/**
 * Called after agent revocation: invalidates all active sessions for the agent
 * and writes one cascade audit entry per invalidated session.
 */
export async function onAgentRevoked(
  tx: Transaction,
  agentId: string,
  orgId: string,
  revokedBy: string,
  ipAddress?: string,
): Promise<void> {
  const now = new Date();

  const revoked = await tx
    .update(agentSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(agentSessions.agentId, agentId),
        isNull(agentSessions.revokedAt),
        gt(agentSessions.expiresAt, now),
      ),
    )
    .returning({ id: agentSessions.id, userId: agentSessions.userId });

  if (revoked.length === 0) return;

  await tx.insert(auditLogs).values(
    revoked.map((session) => ({
      organizationId: orgId,
      userId: revokedBy,
      agentId,
      eventType: "agent.revoke_cascade" as const,
      result: "cascade" as const,
      meta: { sessionId: session.id, revokedSessionUserId: session.userId },
      ipAddress: ipAddress ?? null,
    })),
  );
}

/**
 * Called after an item is soft-deleted: cleans up permissions and writes a cascade audit entry.
 * Soft delete does not trigger ON DELETE CASCADE — explicitly clean up permissions.
 */
export async function onItemDeleted(
  tx: Transaction,
  itemId: string,
  orgId: string,
  deletedBy: string,
  ipAddress?: string,
): Promise<void> {
  await tx.delete(permissions).where(eq(permissions.itemId, itemId));

  await tx.insert(auditLogs).values({
    organizationId: orgId,
    userId: deletedBy,
    itemId,
    eventType: "item.delete_cascade",
    result: "cascade",
    meta: {},
    ipAddress: ipAddress ?? null,
  });
}

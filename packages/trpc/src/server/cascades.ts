import type { Database } from "@abadge/db";
import { and, eq, gt, isNull } from "@abadge/db";
import { agentSessions, auditLogs } from "@abadge/db/schema";

/**
 * Called after agent revocation: invalidates all active sessions for the agent
 * and writes one cascade audit entry per invalidated session.
 */
export async function onAgentRevoked(
  db: Database,
  agentId: string,
  orgId: string,
  revokedBy: string,
): Promise<void> {
  const now = new Date();
  const activeSessions = await db
    .select({ id: agentSessions.id, userId: agentSessions.userId })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.agentId, agentId),
        isNull(agentSessions.revokedAt),
        gt(agentSessions.expiresAt, now),
      ),
    );

  for (const session of activeSessions) {
    await db.update(agentSessions).set({ revokedAt: now }).where(eq(agentSessions.id, session.id));

    await db.insert(auditLogs).values({
      organizationId: orgId,
      userId: revokedBy,
      agentId,
      eventType: "agent.revoke",
      result: "cascade",
      meta: { sessionId: session.id },
    });
  }
}

/**
 * Called after an item is soft-deleted: writes a cascade audit entry.
 * Permission rows are handled by ON DELETE CASCADE at the DB level.
 */
export async function onItemDeleted(
  db: Database,
  itemId: string,
  orgId: string,
  deletedBy: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: orgId,
    userId: deletedBy,
    itemId,
    eventType: "item.delete_cascade",
    result: "cascade",
    meta: {},
  });
}

/**
 * Called when a member is removed from an org: writes a cascade audit entry.
 * Access is enforced at the session-check boundary on the next request.
 */
export async function onMemberRemoved(
  db: Database,
  orgId: string,
  userId: string,
  removedBy: string,
): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: orgId,
    userId: removedBy,
    eventType: "auth.token_revoke",
    result: "cascade",
    meta: { removedUserId: userId },
  });
}

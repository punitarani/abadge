import type { Database } from "@abadge/db";
import { and, eq, gt, inArray, isNull } from "@abadge/db";
import { agentSessions, agents, auditLogs, permissions } from "@abadge/db/schema";

/**
 * Called after agent revocation: invalidates all active sessions for the agent
 * and writes one cascade audit entry per invalidated session.
 */
export async function onAgentRevoked(
  db: Database,
  agentId: string,
  orgId: string,
  revokedBy: string,
  ipAddress?: string,
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
      eventType: "agent.revoke_cascade",
      result: "cascade",
      meta: { sessionId: session.id },
      ipAddress: ipAddress ?? null,
    });
  }
}

/**
 * Called after an item is soft-deleted: cleans up permissions and writes a cascade audit entry.
 * Soft delete does not trigger ON DELETE CASCADE — explicitly clean up permissions.
 */
export async function onItemDeleted(
  db: Database,
  itemId: string,
  orgId: string,
  deletedBy: string,
  ipAddress?: string,
): Promise<void> {
  await db.delete(permissions).where(eq(permissions.itemId, itemId));

  await db.insert(auditLogs).values({
    organizationId: orgId,
    userId: deletedBy,
    itemId,
    eventType: "item.delete_cascade",
    result: "cascade",
    meta: {},
    ipAddress: ipAddress ?? null,
  });
}

/**
 * Called when a member is removed from an org: atomically revokes the member's
 * agents, invalidates their live agent sessions, and deletes any permissions
 * the member had granted — all inside a single transaction so we never leave
 * a partially-revoked state. Writes one cascade audit row per revoked agent
 * and one per deleted permission. The top-level `org.member_remove` event is
 * written by the caller.
 */
export async function onMemberRemoved(
  db: Database,
  orgId: string,
  removedUserId: string,
  removedBy: string,
  ipAddress?: string,
): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Revoke agents created by the removed member.
    const memberAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.organizationId, orgId),
          eq(agents.createdBy, removedUserId),
          eq(agents.enabled, true),
        ),
      );

    if (memberAgents.length > 0) {
      const agentIds = memberAgents.map((a) => a.id);

      await tx
        .update(agents)
        .set({ enabled: false, revokedAt: now })
        .where(inArray(agents.id, agentIds));

      // Invalidate still-live sessions for those agents without overwriting
      // sessions that were already revoked earlier.
      const activeSessions = await tx
        .select({ id: agentSessions.id })
        .from(agentSessions)
        .where(
          and(
            inArray(agentSessions.agentId, agentIds),
            isNull(agentSessions.revokedAt),
            gt(agentSessions.expiresAt, now),
          ),
        );

      if (activeSessions.length > 0) {
        await tx
          .update(agentSessions)
          .set({ revokedAt: now })
          .where(
            inArray(
              agentSessions.id,
              activeSessions.map((s) => s.id),
            ),
          );
      }

      await tx.insert(auditLogs).values(
        memberAgents.map((a) => ({
          organizationId: orgId,
          userId: removedBy,
          agentId: a.id,
          eventType: "agent.revoke_cascade" as const,
          result: "cascade" as const,
          meta: { removedUserId, trigger: "member_remove" },
          ipAddress: ipAddress ?? null,
        })),
      );
    }

    // 2. Delete permissions the removed member had granted (to any agent).
    const removedGrants = await tx
      .select({
        id: permissions.id,
        agentId: permissions.agentId,
        itemId: permissions.itemId,
        capability: permissions.capability,
      })
      .from(permissions)
      .where(and(eq(permissions.organizationId, orgId), eq(permissions.grantedBy, removedUserId)));

    if (removedGrants.length > 0) {
      await tx.delete(permissions).where(
        inArray(
          permissions.id,
          removedGrants.map((g) => g.id),
        ),
      );

      await tx.insert(auditLogs).values(
        removedGrants.map((g) => ({
          organizationId: orgId,
          userId: removedBy,
          agentId: g.agentId,
          itemId: g.itemId,
          eventType: "permission.revoke_cascade" as const,
          result: "cascade" as const,
          meta: {
            permissionId: g.id,
            capability: g.capability,
            trigger: "member_remove",
            removedUserId,
          },
          ipAddress: ipAddress ?? null,
        })),
      );
    }
  });
}

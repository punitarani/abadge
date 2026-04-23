import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "./client";
import { agentSessions, agents, auditLogs, permissions } from "./schema";

/**
 * Called when a member is removed from an org: atomically revokes the member's
 * agents, invalidates their live agent sessions, and deletes any permissions
 * the member had granted. Writes one cascade audit row per revoked agent and
 * one per deleted permission. The top-level `org.member_remove` event is
 * written by the caller.
 *
 * Shared between the tRPC `removeMember` handler and the Better Auth
 * `afterRemoveMember` plugin hook so both paths cascade consistently.
 */
export async function onMemberRemoved(
  tx: Transaction,
  orgId: string,
  removedUserId: string,
  removedBy: string,
  ipAddress?: string,
): Promise<void> {
  const now = new Date();

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
}

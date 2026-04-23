import type { Database } from "@abadge/db";
import { auditLogs } from "@abadge/db";

type AuditInsertRow = typeof auditLogs.$inferInsert;

/**
 * Swallows any error from an audit log insert so callers are never disrupted.
 * Audit writes must not break authentication or org lifecycle operations.
 */
export async function safeAuditInsert(db: Database, values: AuditInsertRow): Promise<void> {
  try {
    await db.insert(auditLogs).values(values);
  } catch {
    // Audit writes must not break the caller
  }
}

/**
 * Builds the audit log row values for an org.create event triggered from the
 * Better Auth organization plugin path (POST /api/auth/organization/create).
 *
 * Tagged surface: "auth" to distinguish from the tRPC-path row which is tagged
 * surface: "api". See the session.create hook in server.ts for the same pattern.
 */
export function buildOrgCreateAuditRow(data: {
  organization: { id: string; slug?: string | null };
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.user.id,
    eventType: "org.create",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: { source: "better_auth_plugin", slug: data.organization.slug ?? null },
  };
}

/**
 * Builds the audit log row values for an org.delete event triggered from the
 * Better Auth organization plugin path.
 */
export function buildOrgDeleteAuditRow(data: {
  organization: { id: string; slug?: string | null };
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.user.id,
    eventType: "org.delete",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: { source: "better_auth_plugin", slug: data.organization.slug ?? null },
  };
}

/**
 * Builds the audit log row for an org.update event (rename, logo change, etc.).
 *
 * Note: Better Auth's afterUpdateOrganization does not expose the previous
 * organization state, and `organization` can be null when the adapter does not
 * return the updated row. We fall back to the org id from context when null.
 */
export function buildOrgUpdateAuditRow(data: {
  organization: { id: string; slug?: string | null; name?: string | null } | null;
  orgId: string;
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization?.id ?? data.orgId,
    userId: data.user.id,
    eventType: "org.update",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: {
      source: "better_auth_plugin",
      slug: data.organization?.slug ?? null,
      name: data.organization?.name ?? null,
    },
  };
}

/**
 * Builds the audit log row for an org.member_add event.
 * `user` = the caller who performed the add action.
 * `member` = the newly-added member row (has userId + role).
 */
export function buildMemberAddAuditRow(data: {
  organization: { id: string };
  member: { userId: string; role: string };
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.user.id,
    eventType: "org.member_add",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: {
      source: "better_auth_plugin",
      addedUserId: data.member.userId,
      role: data.member.role,
    },
  };
}

/**
 * Builds the audit log row for an org.member_remove event.
 *
 * Note: Better Auth's afterRemoveMember passes `user` = the REMOVED user, not
 * the caller. We record the removed user as both userId (actor field) and in meta.
 * This is a limitation of the hook contract — the caller identity is not exposed.
 */
export function buildMemberRemoveAuditRow(data: {
  organization: { id: string };
  member: { userId: string };
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    // user here is the removed user (hook limitation: caller not exposed)
    userId: data.user.id,
    eventType: "org.member_remove",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: {
      source: "better_auth_plugin",
      removedUserId: data.member.userId,
    },
  };
}

/**
 * Builds the audit log row for an org.member_role_change event.
 * `user` = the caller who performed the role update.
 * `previousRole` = flat string from Better Auth's hook payload.
 */
export function buildMemberRoleUpdateAuditRow(data: {
  organization: { id: string };
  member: { userId: string; role: string };
  previousRole: string;
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.user.id,
    eventType: "org.member_role_change",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: {
      source: "better_auth_plugin",
      targetUserId: data.member.userId,
      previousRole: data.previousRole,
      newRole: data.member.role,
    },
  };
}

/**
 * Builds the audit log row for an org.invite event.
 * Better Auth's afterCreateInvitation uses `inviter`, not `user`.
 */
export function buildInviteCreateAuditRow(data: {
  invitation: { id: string; role: string };
  organization: { id: string };
  inviter: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.inviter.id,
    eventType: "org.invite",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: {
      source: "better_auth_plugin",
      invitationId: data.invitation.id,
      role: data.invitation.role,
    },
  };
}

/**
 * Builds the audit log row for an org.invite_accept event.
 * `user` = the invitee who accepted.
 */
export function buildInviteAcceptAuditRow(data: {
  invitation: { id: string };
  organization: { id: string };
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.user.id,
    eventType: "org.invite_accept",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: { source: "better_auth_plugin", invitationId: data.invitation.id },
  };
}

/**
 * Builds the audit log row for an org.invite_reject event.
 * `user` = the invitee who rejected.
 */
export function buildInviteRejectAuditRow(data: {
  invitation: { id: string };
  organization: { id: string };
  user: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.user.id,
    eventType: "org.invite_reject",
    result: "denied",
    ipAddress: null,
    surface: "auth",
    meta: { source: "better_auth_plugin", invitationId: data.invitation.id },
  };
}

/**
 * Builds the audit log row for an org.invite_revoke event (admin cancels invite).
 * Better Auth's afterCancelInvitation uses `cancelledBy`, not `user`.
 */
export function buildInviteCancelAuditRow(data: {
  invitation: { id: string };
  organization: { id: string };
  cancelledBy: { id: string };
}): AuditInsertRow {
  return {
    organizationId: data.organization.id,
    userId: data.cancelledBy.id,
    // Use existing org.invite_revoke — same semantic as tRPC revokeInvitation,
    // distinguished from the tRPC path by surface: "auth".
    eventType: "org.invite_revoke",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: { source: "better_auth_plugin", invitationId: data.invitation.id },
  };
}

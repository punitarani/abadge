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

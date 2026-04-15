/**
 * Minimal shape of the values we write into the audit_logs table.
 * Kept local to avoid a drizzle-orm import in this package.
 */
interface AuditRowValues {
  organizationId: string;
  userId: string;
  eventType: string;
  result: string;
  ipAddress: null;
  surface: string;
  meta: Record<string, unknown>;
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
}): AuditRowValues {
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
}): AuditRowValues {
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

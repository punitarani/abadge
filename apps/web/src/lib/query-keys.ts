import type { AuditQuery } from "@abadge/core";

export const dashboardQueryKeys = {
  items: (): readonly ["items"] => ["items"],
  item: (itemId: string): readonly ["items", string] => ["items", itemId],
  agents: (): readonly ["agents"] => ["agents"],
  agent: (agentId: string): readonly ["agents", string] => ["agents", agentId],
  permissions: (): readonly ["permissions"] => ["permissions"],
  audit: (input: AuditQuery): readonly ["audit", AuditQuery] => ["audit", input],
  organizations: () => ["organizations"] as const,
  organization: (orgId: string) => ["organizations", orgId] as const,
  profiles: (orgId: string) => ["profiles", orgId] as const,
  profile: (profileId: string) => ["profiles", "detail", profileId] as const,
  orgItems: (orgId: string) => ["items", orgId] as const,
  orgAgents: (orgId: string) => ["agents", orgId] as const,
  orgPermissions: (orgId: string) => ["permissions", orgId] as const,
  orgAudit: (orgId: string, input: Record<string, unknown>) => ["audit", orgId, input] as const,
  orgMembers: (orgId: string) => ["members", orgId] as const,
  orgInvites: (orgId: string) => ["invites", orgId] as const,
};

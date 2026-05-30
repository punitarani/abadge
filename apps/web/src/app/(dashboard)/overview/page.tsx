"use client";

import type { Agent, AuditEntry, Permission } from "@abadge/core";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { TableRowsSkeleton } from "@/components/dashboard/skeletons/table-rows-skeleton";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrg } from "@/hooks/use-active-org";
import {
  buildAuditAgentNameMap,
  buildAuditItemLabelMap,
  buildProfileNameMap,
  resolveAuditDisplayValue,
} from "@/lib/audit-display";
import { listAllAgents, listAllItems, listAllPermissions } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { workspacePosture } from "@/lib/workspace-posture";
import { useOrgStore } from "@/stores/org-store";
import { countProfilesByStorage, type ProfilesByStorage } from "./count-profiles-by-storage";

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

function resultBadgeVariant(result: string): BadgeVariant {
  switch (result) {
    case "allowed":
    case "success":
      return "success";
    case "denied":
    case "error":
      return "destructive";
    case "pending":
      return "warning";
    default:
      return "secondary";
  }
}

const AUDIT_COLUMN_COUNT = 6;

function SummaryCards({
  isLoading,
  profilesCardLabel,
  profileCount,
  profilesByStorage,
  itemCount,
  agentCount,
  activeAgentCount,
  revokedAgentCount,
  permissionCount,
  expiringSoonCount,
  auditLoading,
  auditEventCount,
}: {
  isLoading: boolean;
  profilesCardLabel: string;
  profileCount: number;
  profilesByStorage: ProfilesByStorage;
  itemCount: number;
  agentCount: number;
  activeAgentCount: number;
  revokedAgentCount: number;
  permissionCount: number;
  expiringSoonCount: number;
  auditLoading: boolean;
  auditEventCount: number;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryCard
        label={profilesCardLabel}
        loading={isLoading}
        value={profileCount}
        subtitle={`${profilesByStorage.serverManaged} server-managed · ${profilesByStorage.zeroKnowledge} zero-knowledge`}
      />
      <SummaryCard
        label="Items"
        loading={isLoading}
        value={itemCount}
        subtitle="across all profiles"
      />
      <SummaryCard
        label="Agents"
        loading={isLoading}
        value={agentCount}
        subtitle={`${activeAgentCount} active \u00b7 ${revokedAgentCount} revoked`}
      />
      <SummaryCard
        label="Permissions"
        loading={isLoading}
        value={permissionCount}
        subtitle={`${expiringSoonCount} expiring soon`}
      />
      <SummaryCard
        label="Access events"
        loading={isLoading || auditLoading}
        value={auditEventCount}
        subtitle="most recent"
      />
    </div>
  );
}

function RecentEventsTable({
  isPending,
  entries,
  agentNames,
  itemLabels,
  profileNames,
}: {
  isPending: boolean;
  entries: AuditEntry[];
  agentNames: Map<string, string>;
  itemLabels: Map<string, string>;
  profileNames: Map<string, string>;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Profile</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableRowsSkeleton columns={AUDIT_COLUMN_COUNT} rows={5} />
          ) : entries.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={AUDIT_COLUMN_COUNT}
                className="py-12 text-center text-muted-foreground"
              >
                <div className="space-y-2">
                  <div className="font-medium text-foreground">No access events yet</div>
                  <div>Events appear when agents access items.</div>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            entries.map((entry: AuditEntry) => (
              <RecentEventRow
                key={entry.id}
                entry={entry}
                agentNames={agentNames}
                itemLabels={itemLabels}
                profileNames={profileNames}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function RecentEventRow({
  entry,
  agentNames,
  itemLabels,
  profileNames,
}: {
  entry: AuditEntry;
  agentNames: Map<string, string>;
  itemLabels: Map<string, string>;
  profileNames: Map<string, string>;
}): React.ReactElement {
  const agentDisplay = resolveAuditDisplayValue(entry.agentId, agentNames);
  const itemDisplay = resolveAuditDisplayValue(entry.itemId, itemLabels);
  const profileName = entry.profileId ? (profileNames.get(entry.profileId) ?? null) : null;

  return (
    <TableRow>
      <TableCell>
        {profileName ? (
          <Badge variant="secondary">{profileName}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">&mdash;</span>
        )}
      </TableCell>
      <TableCell
        className={
          agentDisplay.resolved
            ? "text-sm text-foreground"
            : "font-mono text-sm text-muted-foreground"
        }
      >
        {agentDisplay.text}
      </TableCell>
      <TableCell
        className={
          itemDisplay.resolved
            ? "text-sm text-foreground"
            : "font-mono text-sm text-muted-foreground"
        }
      >
        {itemDisplay.text}
      </TableCell>
      <TableCell>
        <Badge variant="outline">{entry.eventType}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={resultBadgeVariant(entry.result)}>{entry.result}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatRelativeTime(entry.occurredAt)}
      </TableCell>
    </TableRow>
  );
}

export default function OverviewPage(): React.ReactElement {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { isPersonal } = useActiveOrg();
  const posture = workspacePosture(isPersonal);

  const profilesQuery = useQuery({
    queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });

  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => listAllItems(),
    enabled: !!activeOrgId,
  });

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => listAllAgents(),
    enabled: !!activeOrgId,
  });

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
    queryFn: () => listAllPermissions(),
    enabled: !!activeOrgId,
  });

  const auditInput = { limit: 5 };
  const auditQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAudit(activeOrgId ?? "", auditInput),
    queryFn: () => browserTrpcClient.audit.list.query(auditInput),
    enabled: !!activeOrgId,
  });

  const profiles = profilesQuery.data?.profiles ?? [];
  const items = itemsQuery.data?.items ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const permissions = permissionsQuery.data?.permissions ?? [];
  const auditEntries = auditQuery.data?.entries ?? [];

  const activeAgents = agents.filter((a: Agent) => a.enabled && !a.revokedAt);
  const revokedAgents = agents.filter((a: Agent) => !!a.revokedAt);

  const now = new Date();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const expiringSoonCount = permissions.filter((p: Permission) => {
    if (!p.expiresAt) return false;
    const expiresAt = new Date(p.expiresAt);
    const diff = expiresAt.getTime() - now.getTime();
    return diff > 0 && diff < sevenDaysMs;
  }).length;

  const profilesByStorage = countProfilesByStorage(profiles);

  const agentNames = useMemo(() => buildAuditAgentNameMap(agents), [agents]);
  const itemLabels = useMemo(() => buildAuditItemLabelMap(items), [items]);
  const profileNames = useMemo(() => buildProfileNameMap(profiles), [profiles]);

  const todayFormatted = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const isLoading =
    profilesQuery.isPending ||
    itemsQuery.isPending ||
    agentsQuery.isPending ||
    permissionsQuery.isPending;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">{todayFormatted}</p>
      </div>

      {/* Posture banner — personal vault vs. custody mode */}
      <div className="flex items-start gap-3 rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm text-emerald-800 dark:text-emerald-300">{posture.banner}</p>
      </div>

      {/* Summary cards */}
      <SummaryCards
        isLoading={isLoading}
        profilesCardLabel={posture.profilesCardLabel}
        profileCount={profiles.length}
        profilesByStorage={profilesByStorage}
        itemCount={items.length}
        agentCount={agents.length}
        activeAgentCount={activeAgents.length}
        revokedAgentCount={revokedAgents.length}
        permissionCount={permissions.length}
        expiringSoonCount={expiringSoonCount}
        auditLoading={auditQuery.isPending}
        auditEventCount={auditEntries.length}
      />

      {/* Quick actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Quick actions</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/profiles?create=true">+ New profile</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/items?create=true">+ New item</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/agents?create=true">+ Register agent</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/permissions?create=true">+ Grant permission</Link>
          </Button>
        </div>
      </div>

      {/* Recent access events */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent access events</h2>
          <Link href="/audit" className="text-sm text-muted-foreground hover:text-foreground">
            View audit log &rarr;
          </Link>
        </div>

        <RecentEventsTable
          isPending={auditQuery.isPending}
          entries={auditEntries}
          agentNames={agentNames}
          itemLabels={itemLabels}
          profileNames={profileNames}
        />
      </div>
    </div>
  );
}

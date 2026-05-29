"use client";

import type { AuditEntry, Permission } from "@abadge/core";
import { Trash, Warning } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SecretValueCard, useItemReveal } from "@/components/dashboard/item-detail-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilityBadge } from "@/components/ui/capability-badge";
import { ResultBadge } from "@/components/ui/result-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrg } from "@/hooks/use-active-org";
import { buildAuditAgentNameMap } from "@/lib/audit-display";
import { listAllAgents, listAllPermissions } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

export default function ItemDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const itemId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { isPersonal } = useActiveOrg();

  const itemQuery = useQuery({
    queryKey: dashboardQueryKeys.item(itemId),
    queryFn: () => browserTrpcClient.items.get.query({ itemId }),
    enabled: !!itemId,
  });

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
    queryFn: () => listAllPermissions(),
    enabled: !!activeOrgId,
  });

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => listAllAgents(),
    enabled: !!activeOrgId,
  });

  const auditInput = { itemId, limit: 5 as const };
  const auditQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAudit(activeOrgId ?? "", auditInput),
    queryFn: () => browserTrpcClient.audit.list.query(auditInput),
    enabled: !!activeOrgId && !!itemId,
  });

  const item = itemQuery.data?.item ?? null;
  const allPermissions = permissionsQuery.data?.permissions ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const auditEntries = auditQuery.data?.entries ?? [];

  const itemPermissions = useMemo(
    () => allPermissions.filter((p: Permission) => p.itemId === itemId),
    [allPermissions, itemId],
  );

  const agentNameMap = useMemo(() => buildAuditAgentNameMap(agents), [agents]);

  // Owner-reveal is enabled only for personal accounts (the user owns every
  // secret). Team orgs stay in custody mode and never reveal plaintext here.
  // Called unconditionally before the early returns to keep hook order stable;
  // tolerates a null item.
  const itemReveal = useItemReveal(item);

  const deleteItem = useMutation({
    mutationFn: () => browserTrpcClient.items.delete.mutate({ itemId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
      });
      toast.success("Item deleted.");
      router.push("/items");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to delete item"));
    },
  });

  if (itemQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading item...
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Item not found.
      </div>
    );
  }

  const isZK = item.storageMode === "zero_knowledge";

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/items" className="hover:text-foreground">
          Items
        </Link>
        <span>/</span>
        <span className="text-foreground">{item.label}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{item.label}</h1>
            <Badge variant={isZK ? "default" : "secondary"}>
              {isZK ? "zero_knowledge" : "server_managed"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Created {formatDate(item.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Trash className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete item</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &ldquo;{item.label}&rdquo; and revoke all associated
                  permissions. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => deleteItem.mutate()}
                  disabled={deleteItem.isPending}
                >
                  {deleteItem.isPending ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Personal accounts own their secrets and can reveal them. Team orgs
          stay in custody mode: no plaintext in the dashboard, with a ZK note. */}
      {isPersonal ? (
        <SecretValueCard
          item={item}
          revealedValue={itemReveal.revealedValue}
          revealing={itemReveal.revealing}
          onReveal={itemReveal.reveal}
          onHide={itemReveal.hide}
        />
      ) : (
        isZK && (
          <div className="flex items-start gap-3 rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
            <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              This is a zero-knowledge item. The server never sees the plaintext. Only authorized
              local agents with the vault password can decrypt this item.
            </p>
          </div>
        )
      )}

      {/* Metadata cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetadataCard label="Item ID" value={`${item.id.slice(0, 12)}...`} mono />
        <MetadataCard label="Content Version" value={`v${item.contentVersion}`} />
        <MetadataCard label="Last Modified" value={formatRelativeTime(item.updatedAt)} />
        <MetadataCard label="Active Permissions" value={String(itemPermissions.length)} />
      </div>

      {/* Agent permissions */}
      <AgentPermissionsSection permissions={itemPermissions} agentNameMap={agentNameMap} />

      {/* Recent access events */}
      <RecentAccessSection
        entries={auditEntries}
        agentNameMap={agentNameMap}
        isPending={auditQuery.isPending}
      />
    </div>
  );
}

function MetadataCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function AgentPermissionsSection({
  permissions,
  agentNameMap,
}: {
  permissions: Permission[];
  agentNameMap: Map<string, string>;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const orgId = useOrgStore((s) => s.activeOrgId);

  const revokeMutation = useMutation({
    mutationFn: (permissionId: string) =>
      browserTrpcClient.permissions.revoke.mutate({ permissionId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgPermissions(orgId ?? ""),
      });
      toast.success("Permission revoked.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to revoke permission"));
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agent permissions</h2>
        <Button variant="outline" size="sm" asChild>
          <Link href="/permissions?create=true">Grant permission</Link>
        </Button>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Capability</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No permissions granted for this item.
                </TableCell>
              </TableRow>
            ) : (
              permissions.map((perm: Permission) => (
                <PermissionRow
                  key={perm.id}
                  permission={perm}
                  agentName={agentNameMap.get(perm.agentId) ?? perm.agentId.slice(0, 12)}
                  onRevoke={() => revokeMutation.mutate(perm.id)}
                  isRevoking={revokeMutation.isPending}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PermissionRow({
  permission,
  agentName,
  onRevoke,
  isRevoking,
}: {
  permission: Permission;
  agentName: string;
  onRevoke: () => void;
  isRevoking: boolean;
}): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">{agentName}</TableCell>
      <TableCell>
        <CapabilityBadge capability={permission.capability} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatRelativeTime(permission.createdAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {permission.expiresAt ? formatRelativeTime(permission.expiresAt) : "Never"}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Revoke
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke permission</AlertDialogTitle>
              <AlertDialogDescription>
                This will immediately revoke the &ldquo;{permission.capability}&rdquo; capability
                for this agent. The agent will no longer be able to access this item with this
                capability.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  onRevoke();
                  setConfirmOpen(false);
                }}
                disabled={isRevoking}
              >
                {isRevoking ? "Revoking..." : "Revoke"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

function RecentAccessSection({
  entries,
  agentNameMap,
  isPending,
}: {
  entries: AuditEntry[];
  agentNameMap: Map<string, string>;
  isPending: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Recent access events</h2>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No access events yet.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry: AuditEntry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm">
                    {entry.agentId
                      ? (agentNameMap.get(entry.agentId) ?? entry.agentId.slice(0, 12))
                      : "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.eventType}</Badge>
                  </TableCell>
                  <TableCell>
                    <ResultBadge result={entry.result} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatRelativeTime(entry.occurredAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

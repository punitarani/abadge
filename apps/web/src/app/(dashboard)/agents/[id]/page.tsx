"use client";

import type { Agent, AuditEntry, Permission } from "@abadge/core";
import { Trash } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { OneTimeSecretDisplay } from "@/components/dashboard/one-time-secret-display";
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
import { buildAuditItemLabelMap, resolveAuditDisplayValue } from "@/lib/audit-display";
import { listAllItems, listAllPermissions } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

const KIND_LABELS: Record<string, string> = {
  local_cli: "Local CLI",
  local_mcp: "Local MCP",
  remote: "Remote",
};

const AUTH_LABELS: Record<string, string> = {
  public_key_session: "Ed25519 keypair session",
  legacy_api_key: "Legacy API key",
};

export default function AgentDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const agentId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();

  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);

  const agentQuery = useQuery({
    queryKey: dashboardQueryKeys.agent(agentId),
    queryFn: () => browserTrpcClient.agents.get.query({ agentId }),
    enabled: !!agentId,
  });

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
    queryFn: () => listAllPermissions(),
    enabled: !!activeOrgId,
  });

  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => listAllItems(),
    enabled: !!activeOrgId,
  });

  const auditInput = { agentId, limit: 5 as const };
  const auditQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAudit(activeOrgId ?? "", auditInput),
    queryFn: () => browserTrpcClient.audit.list.query(auditInput),
    enabled: !!activeOrgId && !!agentId,
  });

  const agent = agentQuery.data?.agent ?? null;
  const allPermissions = permissionsQuery.data?.permissions ?? [];
  const items = itemsQuery.data?.items ?? [];
  const auditEntries = auditQuery.data?.entries ?? [];

  const agentPermissions = useMemo(
    () => allPermissions.filter((p: Permission) => p.agentId === agentId),
    [allPermissions, agentId],
  );

  const itemLabelMap = useMemo(() => buildAuditItemLabelMap(items), [items]);

  const rotateMutation = useMutation({
    mutationFn: () => browserTrpcClient.agents.rotate.mutate({ agentId }),
    onSuccess: (result) => {
      setRotatedKey(result.apiKey);
      toast.success("API key regenerated.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to regenerate key"));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => browserTrpcClient.agents.revoke.mutate({ agentId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
      });
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.agent(agentId) });
      toast.success("Agent revoked.");
      router.push("/agents");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to revoke agent"));
    },
  });

  if (agentQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading agent...
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Agent not found.
      </div>
    );
  }

  return (
    <AgentDetailContent
      agent={agent}
      rotatedKey={rotatedKey}
      rotateMutation={rotateMutation}
      revokeMutation={revokeMutation}
      agentPermissions={agentPermissions}
      itemLabelMap={itemLabelMap}
      auditEntries={auditEntries}
      auditPending={auditQuery.isPending}
      onDismissKey={() => setRotatedKey(null)}
    />
  );
}

function AgentDetailContent({
  agent,
  rotatedKey,
  rotateMutation,
  revokeMutation,
  agentPermissions,
  itemLabelMap,
  auditEntries,
  auditPending,
  onDismissKey,
}: {
  agent: Agent;
  rotatedKey: string | null;
  rotateMutation: { mutate: () => void; isPending: boolean };
  revokeMutation: { mutate: () => void; isPending: boolean };
  agentPermissions: Permission[];
  itemLabelMap: Map<string, string>;
  auditEntries: AuditEntry[];
  auditPending: boolean;
  onDismissKey: () => void;
}): React.ReactElement {
  const isRevoked = !!agent.revokedAt;
  const isLegacy = agent.authMethod === "legacy_api_key";

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/agents" className="hover:text-foreground">
          Agents
        </Link>
        <span>/</span>
        <span className="text-foreground">{agent.name}</span>
      </nav>

      {/* Header */}
      <AgentHeader
        agent={agent}
        isRevoked={isRevoked}
        isLegacy={isLegacy}
        rotateMutation={rotateMutation}
        revokeMutation={revokeMutation}
      />

      {/* Rotated key display */}
      {rotatedKey && (
        <OneTimeSecretDisplay value={rotatedKey} type="api_key" onDismiss={onDismissKey} />
      )}

      {/* Metadata cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <MetadataCard label="Agent ID" value={`${agent.id.slice(0, 12)}...`} mono />
        <MetadataCard label="Kind" value={KIND_LABELS[agent.kind] ?? agent.kind} />
        <MetadataCard
          label="Last Used"
          value={agent.lastUsedAt ? formatRelativeTime(agent.lastUsedAt) : "Never"}
        />
        <MetadataCard label="Registered" value={formatDate(agent.createdAt)} />
        <MetadataCard label="Permissions" value={String(agentPermissions.length)} />
      </div>

      {/* Granted permissions */}
      <GrantedPermissionsSection permissions={agentPermissions} itemLabelMap={itemLabelMap} />

      {/* Recent access events */}
      <RecentAccessSection
        entries={auditEntries}
        itemLabelMap={itemLabelMap}
        isPending={auditPending}
      />
    </div>
  );
}

function AgentHeader({
  agent,
  isRevoked,
  isLegacy,
  rotateMutation,
  revokeMutation,
}: {
  agent: {
    name: string;
    kind: string;
    locality: string;
    authMethod: string;
    revokedAt: string | null;
  };
  isRevoked: boolean;
  isLegacy: boolean;
  rotateMutation: { mutate: () => void; isPending: boolean };
  revokeMutation: { mutate: () => void; isPending: boolean };
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{agent.name}</h1>
          {isRevoked ? (
            <Badge variant="destructive">Revoked</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {KIND_LABELS[agent.kind] ?? agent.kind} &middot; {agent.locality} &middot;{" "}
          {AUTH_LABELS[agent.authMethod] ?? agent.authMethod}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isLegacy && !isRevoked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => rotateMutation.mutate()}
            disabled={rotateMutation.isPending}
          >
            {rotateMutation.isPending ? "Regenerating..." : "Regenerate token"}
          </Button>
        )}
        {!isRevoked && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Trash className="mr-1 h-3.5 w-3.5" />
                Revoke agent
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke agent</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently revoke &ldquo;{agent.name}&rdquo; and cascade-remove all its
                  permissions and sessions. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => revokeMutation.mutate()}
                  disabled={revokeMutation.isPending}
                >
                  {revokeMutation.isPending ? "Revoking..." : "Revoke"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
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

function GrantedPermissionsSection({
  permissions,
  itemLabelMap,
}: {
  permissions: Permission[];
  itemLabelMap: Map<string, string>;
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
        <h2 className="text-sm font-semibold">Granted permissions</h2>
        <Button variant="outline" size="sm" asChild>
          <Link href="/permissions?create=true">+ Grant permission</Link>
        </Button>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
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
                  No permissions granted for this agent.
                </TableCell>
              </TableRow>
            ) : (
              permissions.map((perm: Permission) => (
                <PermissionRow
                  key={perm.id}
                  permission={perm}
                  itemName={
                    perm.itemId
                      ? (itemLabelMap.get(perm.itemId) ?? perm.itemId.slice(0, 12))
                      : `profile:${perm.profileId?.slice(0, 12) ?? "?"}`
                  }
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
  itemName,
  onRevoke,
  isRevoking,
}: {
  permission: Permission;
  itemName: string;
  onRevoke: () => void;
  isRevoking: boolean;
}): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">{itemName}</TableCell>
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
                for this item. The agent will no longer be able to access this item with this
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
  itemLabelMap,
  isPending,
}: {
  entries: AuditEntry[];
  itemLabelMap: Map<string, string>;
  isPending: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Recent access events</h2>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
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
              entries.map((entry: AuditEntry) => {
                const itemDisplay = resolveAuditDisplayValue(entry.itemId, itemLabelMap);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm">{itemDisplay.text}</TableCell>
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
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

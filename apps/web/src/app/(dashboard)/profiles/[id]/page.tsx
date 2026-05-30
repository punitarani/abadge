"use client";

import type { Agent, ItemSummary } from "@abadge/core";
import { ArrowRight, Key, Lock, LockOpen, Plus, ShieldCheck, Trash } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailSkeleton } from "@/components/dashboard/skeletons/detail-skeleton";
import { TableRowsSkeleton } from "@/components/dashboard/skeletons/table-rows-skeleton";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAllAgents, listAllItems, listAllPermissions } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

export default function ProfileDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const profileId = params.id;
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { isProfileUnlocked } = useVault();
  const router = useRouter();
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: dashboardQueryKeys.profile(profileId),
    queryFn: () => browserTrpcClient.profiles.get.query({ profileId }),
    enabled: !!profileId,
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

  const profile = profileQuery.data?.profile ?? null;
  const items = itemsQuery.data?.items ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const permissions = permissionsQuery.data?.permissions ?? [];

  const isZK = profile?.storageMode === "zero_knowledge";
  const unlocked = profile ? isProfileUnlocked(profile.id) : false;

  const deleteMutation = useMutation({
    mutationFn: () => browserTrpcClient.profiles.delete.mutate({ profileId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
      });
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.profile(profileId) });
      toast.success("Profile deleted.");
      router.push("/profiles");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to delete profile"));
    },
  });

  /* Permission counts per agent */
  const agentPermissionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of permissions) {
      map.set(p.agentId, (map.get(p.agentId) ?? 0) + 1);
    }
    return map;
  }, [permissions]);

  if (profileQuery.isPending) {
    return <DetailSkeleton />;
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Profile not found.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/profiles" className="hover:text-foreground">
          Profiles
        </Link>
        <span>/</span>
        <span className="text-foreground">{profile.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{profile.name}</h1>
            <Badge variant={isZK ? "default" : "secondary"}>
              {isZK ? "zero_knowledge" : "server_managed"}
            </Badge>
            {isZK && <VaultStatusBadge unlocked={unlocked} />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            ID: <span className="font-mono">{profile.id.slice(0, 12)}...</span>
            {" · "}
            Created {formatDate(profile.createdAt)}
          </p>
        </div>
        <Button variant="outline" size="sm">
          Edit profile
        </Button>
      </div>

      {/* ZK Vault Card */}
      {isZK && <ZKVaultCard unlocked={unlocked} keyVersion={profile.keyVersion} />}

      {/* Items section */}
      <ItemsSection items={items} isPending={itemsQuery.isPending} />

      {/* Agents section */}
      <AgentsSection
        agents={agents}
        agentPermissionCounts={agentPermissionCounts}
        isPending={agentsQuery.isPending}
      />

      {/* Key management */}
      {isZK && <KeyManagementSection />}

      {/* Danger zone */}
      <DangerZone
        profileName={profile.name}
        onDelete={() => deleteMutation.mutate()}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

/* ---- Sub-components ---- */

function VaultStatusBadge({ unlocked }: { unlocked: boolean }): React.ReactElement {
  return (
    <Badge variant={unlocked ? "success" : "secondary"} className="gap-1">
      {unlocked ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
      {unlocked ? "Unlocked" : "Locked"}
    </Badge>
  );
}

function ZKVaultCard({
  unlocked,
  keyVersion,
}: {
  unlocked: boolean;
  keyVersion: number;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          <h2 className="text-sm font-semibold">Zero-knowledge vault</h2>
        </div>
        <VaultStatusBadge unlocked={unlocked} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Root key held in memory only. Server never sees plaintext.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <InfoBox label="KDF" value="Argon2id" />
        <InfoBox label="Encryption" value="XChaCha20-Poly1305" />
        <InfoBox label="Key Version" value={`v${keyVersion}`} />
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

function ItemsSection({
  items,
  isPending,
}: {
  items: ItemSummary[];
  isPending: boolean;
}): React.ReactElement {
  // Items are scoped to the organization, not individual profiles.
  // The API does not expose a profileId on ItemSummary, so we show all org items here.
  const preview = items.slice(0, 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Items</h2>
        <div className="flex items-center gap-2">
          <Link href="/items" className="text-xs text-muted-foreground hover:text-foreground">
            View all {items.length} <ArrowRight className="ml-0.5 inline h-3 w-3" />
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href="/items?create=true">
              <Plus className="mr-1 h-3 w-3" />
              New item
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRowsSkeleton columns={3} rows={3} action />
            ) : preview.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  No items yet.
                </TableCell>
              </TableRow>
            ) : (
              preview.map((item: ItemSummary) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {item.storageMode === "zero_knowledge" ? "ZK" : "Server"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/items/${item.id}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      View
                    </Link>
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

function AgentsSection({
  agents,
  agentPermissionCounts,
  isPending,
}: {
  agents: Agent[];
  agentPermissionCounts: Map<string, number>;
  isPending: boolean;
}): React.ReactElement {
  const preview = agents.slice(0, 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agents</h2>
        <div className="flex items-center gap-2">
          <Link href="/agents" className="text-xs text-muted-foreground hover:text-foreground">
            View all {agents.length} <ArrowRight className="ml-0.5 inline h-3 w-3" />
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href="/agents?create=true">
              <Plus className="mr-1 h-3 w-3" />
              Register agent
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRowsSkeleton columns={6} rows={3} action />
            ) : preview.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  No agents yet.
                </TableCell>
              </TableRow>
            ) : (
              preview.map((agent: Agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">{agent.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{agent.kind}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {agent.authMethod === "public_key_session" ? "Keypair" : "API key"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href="/permissions"
                      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {agentPermissionCounts.get(agent.id) ?? 0}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {agent.lastUsedAt ? formatRelativeTime(agent.lastUsedAt) : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/agents/${agent.id}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      View
                    </Link>
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

function KeyManagementSection(): React.ReactElement {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Key management</h2>
        <p className="text-xs text-muted-foreground">
          Manage the zero-knowledge root key for this profile.
        </p>
      </div>

      <div className="space-y-2">
        <KeyActionRow
          icon={<Lock className="h-4 w-4" />}
          title="Change profile password"
          description="Derive a new KEK and re-wrap the existing root key. Items are not re-encrypted."
          actionLabel="Change"
          onClick={() =>
            toast.info("Use the CLI: abadge profile change-password", {
              description:
                "Profile password changes require your local daemon. Run the command in a terminal to proceed.",
              duration: 6000,
            })
          }
        />
        <KeyActionRow
          icon={<Key className="h-4 w-4" />}
          title="Rotate item keys"
          description="Generate a new root key and re-encrypt all item DEKs. Use after a suspected key compromise."
          actionLabel="Rotate"
          onClick={() =>
            toast.info("Key rotation is not yet available in the dashboard.", {
              description:
                "This operation requires your local daemon and is under active development.",
              duration: 6000,
            })
          }
        />
        <KeyActionRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Recovery key"
          description="View or regenerate the recovery key for this profile."
          actionLabel="View"
          onClick={() =>
            toast.info("Recovery key management is not yet available in the dashboard.", {
              description:
                "This operation requires your local daemon and is under active development.",
              duration: 6000,
            })
          }
        />
      </div>
    </div>
  );
}

function KeyActionRow({
  icon,
  title,
  description,
  actionLabel,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onClick}>
        {actionLabel}
      </Button>
    </div>
  );
}

function DangerZone({
  profileName,
  onDelete,
  isDeleting,
}: {
  profileName: string;
  onDelete: () => void;
  isDeleting: boolean;
}): React.ReactElement {
  const [confirmInput, setConfirmInput] = useState("");

  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-5 dark:border-yellow-700 dark:bg-yellow-950/20">
      <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Danger zone</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Irreversible actions. Proceed with caution.
      </p>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3">
        <div className="flex items-start gap-3">
          <Trash className="mt-0.5 h-4 w-4 text-red-500" />
          <div>
            <div className="text-sm font-medium">Delete profile</div>
            <div className="text-xs text-muted-foreground">
              Permanently delete &ldquo;{profileName}&rdquo; and all associated data. This cannot be
              undone.
            </div>
          </div>
        </div>
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) setConfirmInput("");
          }}
        >
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete profile</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{profileName}&rdquo; and all associated data.
                The profile must have no items before it can be deleted. This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground" htmlFor="confirm-profile-name">
                Type <span className="font-mono font-semibold">{profileName}</span> to confirm
              </label>
              <Input
                id="confirm-profile-name"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={profileName}
                autoComplete="off"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={confirmInput !== profileName || isDeleting}
                onClick={onDelete}
              >
                {isDeleting ? "Deleting…" : "Delete profile"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

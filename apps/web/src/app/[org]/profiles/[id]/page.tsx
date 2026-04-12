"use client";

import type { Agent, ItemSummary } from "@abadge/core";
import { ArrowRight, Key, Lock, LockOpen, Plus, ShieldCheck, Trash } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
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
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";

export default function ProfileDetailPage(): React.ReactElement {
  const params = useParams<{ org: string; id: string }>();
  const orgSlug = params.org;
  const profileId = params.id;
  const { isProfileUnlocked } = useVault();

  const profileQuery = useQuery({
    queryKey: dashboardQueryKeys.profile(profileId),
    queryFn: () => browserTrpcClient.profiles.get.query({ profileId }),
    enabled: !!profileId,
  });

  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
  });

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.agents(),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.permissions(),
    queryFn: () => browserTrpcClient.permissions.list.query({}),
  });

  const profile = profileQuery.data?.profile ?? null;
  const items = itemsQuery.data?.items ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const permissions = permissionsQuery.data?.permissions ?? [];

  const isZK = profile?.storageMode === "zero_knowledge";
  const unlocked = profile ? isProfileUnlocked(profile.id) : false;

  /* Permission counts per agent */
  const agentPermissionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of permissions) {
      map.set(p.agentId, (map.get(p.agentId) ?? 0) + 1);
    }
    return map;
  }, [permissions]);

  if (profileQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading profile...
      </div>
    );
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
        <Link href={`/${orgSlug}/profiles`} className="hover:text-foreground">
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
            {items.length} items
            {" · "}
            {agents.length} agents
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
      <ItemsSection items={items} orgSlug={orgSlug} />

      {/* Agents section */}
      <AgentsSection
        agents={agents}
        agentPermissionCounts={agentPermissionCounts}
        orgSlug={orgSlug}
      />

      {/* Key management */}
      {isZK && <KeyManagementSection />}

      {/* Danger zone */}
      <DangerZone profileName={profile.name} />
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
  orgSlug,
}: {
  items: ItemSummary[];
  orgSlug: string;
}): React.ReactElement {
  const preview = items.slice(0, 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Items</h2>
        <div className="flex items-center gap-2">
          <Link
            href={`/${orgSlug}/items`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all {items.length} <ArrowRight className="ml-0.5 inline h-3 w-3" />
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${orgSlug}/items?create=true`}>
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
            {preview.length === 0 ? (
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
                      href={`/${orgSlug}/items/${item.id}`}
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
  orgSlug,
}: {
  agents: Agent[];
  agentPermissionCounts: Map<string, number>;
  orgSlug: string;
}): React.ReactElement {
  const preview = agents.slice(0, 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agents</h2>
        <div className="flex items-center gap-2">
          <Link
            href={`/${orgSlug}/agents`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all {agents.length} <ArrowRight className="ml-0.5 inline h-3 w-3" />
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${orgSlug}/agents?create=true`}>
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
            {preview.length === 0 ? (
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
                      href={`/${orgSlug}/permissions`}
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
                      href={`/${orgSlug}/agents/${agent.id}`}
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
          title="Change vault password"
          description="Derive a new KEK and re-wrap the existing root key. Items are not re-encrypted."
          actionLabel="Change"
        />
        <KeyActionRow
          icon={<Key className="h-4 w-4" />}
          title="Rotate item keys"
          description="Generate a new root key and re-encrypt all item DEKs. Use after a suspected key compromise."
          actionLabel="Rotate"
        />
        <KeyActionRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Recovery key"
          description="View or regenerate the recovery key for this profile."
          actionLabel="View"
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
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
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
      <Button variant="outline" size="sm">
        {actionLabel}
      </Button>
    </div>
  );
}

function DangerZone({ profileName }: { profileName: string }): React.ReactElement {
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
        <Button
          variant="outline"
          size="sm"
          className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

"use client";

import type { Profile } from "@abadge/core";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ProfileCreateDrawer } from "@/components/dashboard/profile-create-drawer";
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
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

type StorageFilter = "all" | "zero_knowledge" | "server_managed";
type VaultStatusFilter = "all" | "unlocked" | "locked";

const TABLE_COL_COUNT = 5;

export default function ProfilesListPage(): React.ReactElement {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { isProfileUnlocked } = useVault();
  const router = useRouter();
  const searchParams = useSearchParams();
  const createOpen = searchParams.get("create") === "true";

  function closeDrawer(): void {
    const params = new URLSearchParams(searchParams);
    params.delete("create");
    const qs = params.toString();
    router.replace(qs ? `/profiles?${qs}` : "/profiles", { scroll: false });
  }

  const [search, setSearch] = useState("");
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [vaultFilter, setVaultFilter] = useState<VaultStatusFilter>("all");

  const profilesQuery = useQuery({
    queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });

  const profiles = profilesQuery.data?.profiles ?? [];

  const filtered = useMemo(() => {
    let result = profiles;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p: Profile) => p.name.toLowerCase().includes(q));
    }

    if (storageFilter !== "all") {
      result = result.filter((p: Profile) => p.storageMode === storageFilter);
    }

    if (vaultFilter !== "all") {
      result = result.filter((p: Profile) => {
        if (p.storageMode !== "zero_knowledge") return vaultFilter === "locked";
        return vaultFilter === "unlocked" ? isProfileUnlocked(p.id) : !isProfileUnlocked(p.id);
      });
    }

    return result;
  }, [profiles, search, storageFilter, vaultFilter, isProfileUnlocked]);

  const isLoading = profilesQuery.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Credential namespaces under your custody — one per user or entity.
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/profiles?create=true">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New profile
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search profiles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>

        <select
          value={storageFilter}
          onChange={(e) => setStorageFilter(e.target.value as StorageFilter)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All storage</option>
          <option value="zero_knowledge">Zero knowledge</option>
          <option value="server_managed">Server managed</option>
        </select>

        <select
          value={vaultFilter}
          onChange={(e) => setVaultFilter(e.target.value as VaultStatusFilter)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All vault status</option>
          <option value="unlocked">Unlocked</option>
          <option value="locked">Locked</option>
        </select>

        <Badge variant="secondary">{filtered.length} profiles</Badge>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile name</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Vault</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={TABLE_COL_COUNT}
                  className="py-8 text-center text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={TABLE_COL_COUNT}
                  className="py-12 text-center text-muted-foreground"
                >
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No profiles found</div>
                    <div>
                      {profiles.length === 0
                        ? "Create your first profile to get started."
                        : "Try adjusting your filters."}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((profile: Profile) => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  isUnlocked={
                    profile.storageMode === "zero_knowledge" ? isProfileUnlocked(profile.id) : null
                  }
                  isDefault={profile.name === "default"}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {activeOrgId && (
        <ProfileCreateDrawer
          open={createOpen}
          onOpenChange={(next) => {
            if (!next) closeDrawer();
          }}
          orgId={activeOrgId}
        />
      )}
    </div>
  );
}

function ProfileRow({
  profile,
  isUnlocked,
  isDefault,
}: {
  profile: Profile;
  isUnlocked: boolean | null;
  isDefault: boolean;
}): React.ReactElement {
  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/profiles/${profile.id}`}
          className="font-medium text-foreground hover:underline"
        >
          {profile.name}
        </Link>
        {isDefault && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            DEFAULT
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {profile.id.slice(0, 8)}...
      </TableCell>
      <TableCell>
        <Badge variant={profile.storageMode === "zero_knowledge" ? "default" : "secondary"}>
          {profile.storageMode === "zero_knowledge" ? "ZK" : "Server"}
        </Badge>
      </TableCell>
      <TableCell>
        <VaultStatusDot status={isUnlocked} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatRelativeTime(profile.createdAt)}
      </TableCell>
    </TableRow>
  );
}

function VaultStatusDot({ status }: { status: boolean | null }): React.ReactElement {
  if (status === null) {
    return <span className="text-xs text-muted-foreground">N/A</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={`inline-block h-2 w-2 rounded-full ${status ? "bg-emerald-500" : "bg-gray-400"}`}
      />
      {status ? "Unlocked" : "Locked"}
    </span>
  );
}

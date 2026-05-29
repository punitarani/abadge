"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DangerZoneSection } from "@/components/dashboard/danger-zone-section";
import { OneTimeSecretDisplay } from "@/components/dashboard/one-time-secret-display";
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
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveOrg } from "@/hooks/use-active-org";
import { authClient } from "@/lib/auth-client";
import { listAllItems } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { workspacePosture } from "@/lib/workspace-posture";
import { useOrgStore } from "@/stores/org-store";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ROLE_BADGE_STYLES: Record<string, string> = {
  owner: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  admin: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  member: "bg-zinc-50 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300",
};

function getInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const first = (parts[0] ?? "").charAt(0);
  const second = (parts[1] ?? "").charAt(0);
  if (first && second) {
    return (first + second).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

/** Best display name for a member: real name, else email, else a short id. */
function memberDisplayName(m: { name?: string; email?: string | null; userId: string }): string {
  return m.name?.trim() || m.email?.trim() || `${m.userId.slice(0, 8)}…`;
}

export default function SettingsPage(): React.ReactElement | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrgName = useOrgStore((s) => s.activeOrgName);
  const activeOrgSlug = useOrgStore((s) => s.activeOrgSlug);
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  // ---- Org details ----
  // `organizations.get` is prefetched for this route, so it is usually warm on
  // arrival. We still seed the name/slug from the persisted store (and the
  // cached org list) so the account and danger-zone sections paint instantly
  // with their real values instead of popping in once the query resolves —
  // the authoritative values overwrite the seed seamlessly when they match.
  const orgQuery = useQuery({
    queryKey: dashboardQueryKeys.organization(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.organizations.get.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });
  // Personal accounts are single-user vaults: present "account" framing and
  // hide org-collaboration surfaces (members, invites). To collaborate, the
  // user creates a separate team organization. Read `isPersonal` from the
  // already-cached org list (via useActiveOrg) so the framing is correct on
  // first paint rather than flashing the team copy until `organizations.get`
  // resolves.
  const { org: activeOrg, isPersonal } = useActiveOrg();
  const orgName = orgQuery.data?.organization.name ?? activeOrg?.name ?? activeOrgName ?? "";
  const orgSlug = orgQuery.data?.organization.slug ?? activeOrg?.slug ?? activeOrgSlug ?? "";

  // ---- Members ----
  const membersQuery = useQuery({
    queryKey: dashboardQueryKeys.orgMembers(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.organizations.members.list.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });
  const members = membersQuery.data?.members ?? [];

  // ---- Items (for danger zone count) ----
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => listAllItems(),
    enabled: !!activeOrgId,
  });
  const itemCount = itemsQuery.data?.items?.length ?? 0;

  // Gate the whole page on a resolved active org. The dashboard shell already
  // guarantees this before rendering children, so it is effectively always
  // present here — the guard just keeps the section props non-null.
  if (!activeOrgId) {
    return null;
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/overview" className="hover:text-foreground">
          {orgName}
        </Link>
        <span>/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isPersonal
            ? "Manage your personal account and security."
            : "Manage your organization settings, members, and API keys."}
        </p>
      </div>

      {/* Organization / account section */}
      <OrgGeneralSection
        orgId={activeOrgId}
        orgName={orgName}
        orgSlug={orgSlug}
        isPersonal={isPersonal}
        queryClient={queryClient}
      />

      {/* Members section — team organizations only. A personal account is a
          single-user vault, so inviting members would contradict "personal". */}
      {!isPersonal && (
        <MembersSection
          orgId={activeOrgId}
          members={members}
          isPending={membersQuery.isPending}
          currentUserId={currentUserId}
          queryClient={queryClient}
        />
      )}

      {/* API keys section */}
      <ApiKeysSection orgId={activeOrgId} queryClient={queryClient} />

      {/* Danger zone */}
      <DangerZoneSection
        orgId={activeOrgId}
        orgName={orgName}
        itemCount={itemCount}
        itemsLoading={itemsQuery.isPending}
        isPersonal={isPersonal}
        queryClient={queryClient}
        router={router}
      />
    </div>
  );
}

/* ---- Organization General ---- */

function OrgGeneralSection({
  orgId,
  orgName,
  orgSlug,
  isPersonal,
  queryClient,
}: {
  orgId: string;
  orgName: string;
  orgSlug: string;
  isPersonal: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}): React.ReactElement {
  const [name, setName] = useState(orgName);
  const { accountNoun, accountNounLower } = workspacePosture(isPersonal);
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const activeOrgLogo = useOrgStore((s) => s.activeOrgLogo);

  // Resync the field to the authoritative server name when it changes (e.g. after
  // switching orgs or a refetch), so the input and the Save-disabled comparison
  // never wedge against a stale value.
  useEffect(() => {
    setName(orgName);
  }, [orgName]);

  const updateMutation = useMutation({
    mutationFn: () => browserTrpcClient.organizations.update.mutate({ orgId, name: name.trim() }),
    onSuccess: async () => {
      // Push the new name into the persisted store so the breadcrumb and any
      // other store-backed chrome update immediately — the org-list refetch
      // below keeps the sidebar switcher in sync, but it reads the cached list,
      // not the store.
      setActiveOrg({ id: orgId, slug: orgSlug, name: name.trim(), logo: activeOrgLogo });
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organization(orgId) });
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });
      toast.success(`${accountNoun} name updated.`);
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, `Failed to update ${accountNounLower}`));
    },
  });

  function handleSave(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim() || name.trim() === orgName) return;
    updateMutation.mutate();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">{accountNoun}</h2>
      <Card className="p-5">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">{accountNoun} name</Label>
            <div className="flex items-center gap-3">
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-sm"
              />
              <Button
                type="submit"
                disabled={updateMutation.isPending || !name.trim() || name.trim() === orgName}
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-slug">Slug (read-only)</Label>
            <Input id="org-slug" value={orgSlug} disabled className="max-w-sm" />
            <p className="text-xs text-muted-foreground">
              Cannot be changed after creation. Used in API paths.
            </p>
          </div>
        </form>
      </Card>
    </section>
  );
}

/* ---- Members ---- */

function MembersSection({
  orgId,
  members,
  isPending,
  currentUserId,
  queryClient,
}: {
  orgId: string;
  members: Array<{
    id: string;
    userId: string;
    name: string;
    email: string | null;
    role: string;
    createdAt: string;
  }>;
  isPending: boolean;
  currentUserId: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
}): React.ReactElement {
  const [memberToRemove, setMemberToRemove] = useState<{ id: string; label: string } | null>(null);

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      browserTrpcClient.organizations.members.remove.mutate({ orgId, memberId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgMembers(orgId) });
      toast.success("Member removed.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to remove member"));
    },
  });

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">Members</h2>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRowsSkeleton rows={3} columns={4} action />
            ) : members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No members found.
                </TableCell>
              </TableRow>
            ) : (
              members.map((m) => {
                const isCurrentUser = m.userId === currentUserId;
                const displayName = memberDisplayName(m);
                // Only show the email as a secondary line when it adds info
                // beyond the primary label (admins/owners see member emails).
                const secondary = m.email && m.email.trim() !== displayName ? m.email : null;

                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{displayName}</span>
                            {isCurrentUser && (
                              <Badge variant="secondary" className="text-[10px]">
                                You
                              </Badge>
                            )}
                          </div>
                          {secondary && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {secondary}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`border-transparent text-[11px] ${ROLE_BADGE_STYLES[m.role] ?? ""}`}
                      >
                        {ROLE_LABELS[m.role] ?? m.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelativeTime(m.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isCurrentUser && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={removeMutation.isPending}
                          onClick={() =>
                            setMemberToRemove({
                              id: m.id,
                              label: displayName,
                            })
                          }
                        >
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Invite member */}
      <InviteMemberCard orgId={orgId} />

      {/* TODO(B4.1): integration test that member-remove requires the confirmation dialog. */}
      <AlertDialog
        open={memberToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {memberToRemove?.label ?? "member"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke their access to the organization. Their agents will be disabled and
              permissions deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => {
                if (memberToRemove) {
                  removeMutation.mutate(memberToRemove.id);
                  setMemberToRemove(null);
                }
              }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/* ---- Invite Member ---- */

function InviteMemberCard({ orgId }: { orgId: string }): React.ReactElement {
  const [role, setRole] = useState<"member" | "admin" | "owner">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: () => browserTrpcClient.organizations.members.invite.mutate({ orgId, role }),
    onSuccess: (data) => {
      const link = `${window.location.origin}/invite/accept?token=${encodeURIComponent(data.token)}`;
      setInviteLink(link);
      setCopied(false);
      toast.success("Invite link generated.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to generate invite link"));
    },
  });

  function handleGenerate(e: React.FormEvent): void {
    e.preventDefault();
    setInviteLink(null);
    inviteMutation.mutate();
  }

  async function handleCopy(): Promise<void> {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success("Copied to clipboard.");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="p-5">
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Invite member</h3>
          <p className="text-xs text-muted-foreground">
            Generate a one-time invite link. The link expires in 7 days.
          </p>
        </div>
        <form onSubmit={handleGenerate} className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as "member" | "admin" | "owner")}
              >
                <SelectTrigger id="invite-role" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Generating..." : "Generate link"}
            </Button>
          </div>

          {inviteLink && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
              <code className="flex-1 text-xs truncate select-all">{inviteLink}</code>
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </form>
      </div>
    </Card>
  );
}

/* ---- API keys ---- */

const API_KEY_EXPIRY_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
] as const;

type ApiKeyExpiry = (typeof API_KEY_EXPIRY_OPTIONS)[number]["value"];

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  revokedAt: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function apiKeyStatus(k: ApiKeyRow): {
  label: string;
  variant: "success" | "warning" | "destructive";
} {
  if (k.revokedAt) return { label: "Revoked", variant: "destructive" };
  if (k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now()) {
    return { label: "Expired", variant: "warning" };
  }
  return { label: "Active", variant: "success" };
}

function ApiKeysSection({
  orgId,
  queryClient,
}: {
  orgId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<ApiKeyExpiry>("never");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<{ id: string; label: string } | null>(null);

  const keysQuery = useQuery({
    queryKey: dashboardQueryKeys.orgApiKeys(orgId),
    queryFn: () => browserTrpcClient.apiKeys.list.query(),
    enabled: !!orgId,
  });
  const apiKeys = keysQuery.data?.apiKeys ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      const days = expiry === "never" ? null : Number(expiry);
      const expiresAt =
        days === null ? undefined : new Date(Date.now() + days * 86_400_000).toISOString();
      return browserTrpcClient.apiKeys.create.mutate({
        name: name.trim(),
        ...(expiresAt ? { expiresAt } : {}),
      });
    },
    onSuccess: async (result) => {
      setCreatedKey(result.key);
      setName("");
      setExpiry("never");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgApiKeys(orgId) });
      toast.success("API key created.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to create API key"));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => browserTrpcClient.apiKeys.revoke.mutate({ keyId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgApiKeys(orgId) });
      toast.success("API key revoked.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to revoke API key"));
    },
  });

  function handleCreate(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">API keys</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Personal keys for the abadge API, sent as <code className="font-mono">Bearer</code>{" "}
          tokens. They act as you for management operations and cannot read or mount secret values.
        </p>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keysQuery.isPending ? (
              <TableRowsSkeleton rows={3} columns={6} action />
            ) : apiKeys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : (
              apiKeys.map((k: ApiKeyRow) => {
                const status = apiKeyStatus(k);
                const revocable = !k.revokedAt;
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      <code className="font-mono text-xs text-muted-foreground">
                        {k.keyPrefix}…
                      </code>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatRelativeTime(k.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className="text-[11px]">
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {revocable && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={revokeMutation.isPending}
                          onClick={() => setKeyToRevoke({ id: k.id, label: k.name })}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Card className="p-5">
        {createdKey ? (
          <OneTimeSecretDisplay
            value={createdKey}
            type="api_key"
            onDismiss={() => setCreatedKey(null)}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Create API key</h3>
              <p className="text-xs text-muted-foreground">
                The key is shown once on creation. Store it somewhere safe.
              </p>
            </div>
            <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  placeholder="CI deploy bot"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={255}
                  className="w-56"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-key-expiry">Expires</Label>
                <Select value={expiry} onValueChange={(v) => setExpiry(v as ApiKeyExpiry)}>
                  <SelectTrigger id="api-key-expiry" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {API_KEY_EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
                {createMutation.isPending ? "Creating..." : "Create key"}
              </Button>
            </form>
          </div>
        )}
      </Card>

      <AlertDialog
        open={keyToRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setKeyToRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {keyToRevoke?.label ?? "API key"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately disables the key. Any script or integration using it will stop
              working. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={() => {
                if (keyToRevoke) {
                  revokeMutation.mutate(keyToRevoke.id);
                  setKeyToRevoke(null);
                }
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

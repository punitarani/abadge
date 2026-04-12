"use client";

import { Trash, Warning } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
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
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
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

function getInitials(userId: string): string {
  return userId.slice(0, 2).toUpperCase();
}

export default function SettingsPage(): React.ReactElement {
  const params = useParams<{ org: string }>();
  const orgSlug = params.org;
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrgName = useOrgStore((s) => s.activeOrgName);
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  // ---- Org details ----
  const orgQuery = useQuery({
    queryKey: dashboardQueryKeys.organization(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.organizations.get.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });
  const org = orgQuery.data?.organization;

  // ---- Members ----
  const membersQuery = useQuery({
    queryKey: dashboardQueryKeys.orgMembers(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.organizations.members.list.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });
  const members = membersQuery.data?.members ?? [];

  // ---- Items (for danger zone count) ----
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
    enabled: !!activeOrgId,
  });
  const itemCount = itemsQuery.data?.items?.length ?? 0;

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href={`/${orgSlug}/overview`} className="hover:text-foreground">
          {activeOrgName ?? orgSlug}
        </Link>
        <span>/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your organization settings, members, and billing.
        </p>
      </div>

      {/* Organization section */}
      {org && activeOrgId && (
        <OrgGeneralSection
          orgId={activeOrgId}
          orgName={org.name}
          orgSlug={org.slug}
          queryClient={queryClient}
        />
      )}

      {/* Members section */}
      {activeOrgId && (
        <MembersSection
          orgId={activeOrgId}
          members={members}
          isPending={membersQuery.isPending}
          currentUserId={currentUserId}
          queryClient={queryClient}
        />
      )}

      {/* Danger zone */}
      {org && activeOrgId && (
        <DangerZoneSection
          orgId={activeOrgId}
          orgName={org.name}
          itemCount={itemCount}
          queryClient={queryClient}
          router={router}
        />
      )}
    </div>
  );
}

/* ---- Organization General ---- */

function OrgGeneralSection({
  orgId,
  orgName,
  orgSlug,
  queryClient,
}: {
  orgId: string;
  orgName: string;
  orgSlug: string;
  queryClient: ReturnType<typeof useQueryClient>;
}): React.ReactElement {
  const [name, setName] = useState(orgName);

  const updateMutation = useMutation({
    mutationFn: () => browserTrpcClient.organizations.update.mutate({ orgId, name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organization(orgId) });
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });
      toast.success("Organization name updated.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to update organization"));
    },
  });

  function handleSave(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim() || name === orgName) return;
    updateMutation.mutate();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">Organization</h2>
      <Card className="p-5 space-y-4">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <div className="flex items-center gap-3">
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-sm"
              />
              <Button
                type="submit"
                size="sm"
                disabled={updateMutation.isPending || !name.trim() || name === orgName}
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
  members: Array<{ id: string; userId: string; role: string; createdAt: string }>;
  isPending: boolean;
  currentUserId: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
}): React.ReactElement {
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
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No members found.
                </TableCell>
              </TableRow>
            ) : (
              members.map((m) => {
                const isCurrentUser = m.userId === currentUserId;

                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          <AvatarFallback>{getInitials(m.userId)}</AvatarFallback>
                        </Avatar>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{m.userId.slice(0, 8)}...</span>
                          {isCurrentUser && (
                            <Badge variant="secondary" className="text-[10px]">
                              You
                            </Badge>
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
                          onClick={() => removeMutation.mutate(m.id)}
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
      <InviteMemberCard orgId={orgId} queryClient={queryClient} />
    </section>
  );
}

/* ---- Invite Member ---- */

function InviteMemberCard({
  orgId,
  queryClient,
}: {
  orgId: string;
  queryClient: ReturnType<typeof useQueryClient>;
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "owner">("member");

  const inviteMutation = useMutation({
    mutationFn: () => browserTrpcClient.organizations.members.invite.mutate({ orgId, email, role }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgMembers(orgId) });
      setEmail("");
      setRole("member");
      toast.success("Invitation sent.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to send invitation"));
    },
  });

  function handleInvite(e: React.FormEvent): void {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMutation.mutate();
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-medium mb-3">Invite member</h3>
      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px] space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="colleague@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin" | "owner")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" size="sm" disabled={inviteMutation.isPending || !email.trim()}>
          {inviteMutation.isPending ? "Sending..." : "Send invite"}
        </Button>
      </form>
    </Card>
  );
}

/* ---- Danger Zone ---- */

function DangerZoneSection({
  orgId,
  orgName,
  itemCount,
  queryClient,
  router,
}: {
  orgId: string;
  orgName: string;
  itemCount: number;
  queryClient: ReturnType<typeof useQueryClient>;
  router: ReturnType<typeof useRouter>;
}): React.ReactElement {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const hasItems = itemCount > 0;

  const deleteMutation = useMutation({
    mutationFn: () => browserTrpcClient.organizations.delete.mutate({ orgId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });
      toast.success("Organization deleted.");
      router.push("/onboarding");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to delete organization"));
    },
  });

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm text-muted-foreground mb-4">
          Permanently delete this organization and all its data. This action cannot be undone.
        </p>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Delete organization</p>
            {hasItems && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Warning className="h-3.5 w-3.5" />
                Blocked if items exist ({itemCount} item{itemCount !== 1 ? "s" : ""})
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            disabled={hasItems}
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{orgName}</strong> and all associated data
              including profiles, agents, and permissions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-org-name">
              Type <strong>{orgName}</strong> to confirm
            </Label>
            <Input
              id="confirm-org-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={orgName}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmText !== orgName || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete organization"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

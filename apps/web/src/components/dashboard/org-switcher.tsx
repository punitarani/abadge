"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, TicketCheck } from "lucide-react";
import { useState } from "react";
import { CreateOrgForm } from "@/components/onboarding/create-org-form";
import { InviteAcceptForm } from "@/components/onboarding/invite-accept-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

function getOrgInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

const ORG_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-teal-600",
];

function getOrgColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return ORG_COLORS[Math.abs(hash) % ORG_COLORS.length] ?? "bg-blue-600";
}

interface Org {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
  hasBootstrappedProfile: boolean;
}

function OrgIcon({ org, size = "md" }: { org: Org; size?: "sm" | "md" }): React.ReactElement {
  const dimension = size === "sm" ? "size-5" : "size-6";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  if (org.logo) {
    return <img src={org.logo} alt={org.name} className={`${dimension} rounded-full`} />;
  }

  return (
    <div
      className={`flex aspect-square ${dimension} items-center justify-center rounded-full ${textSize} font-medium text-white ${getOrgColor(org.name)}`}
    >
      {getOrgInitial(org.name)}
    </div>
  );
}

export function OrgSwitcher(): React.ReactElement {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // The persistent shell renders OrgSwitcher before DashboardGate confirms
  // auth, so guard the org-list fetch on session presence to avoid firing a
  // guaranteed 401 against the API on any unauthenticated dashboard URL hit.
  // Mirrors the same guard in DashboardGate's organizations.list query — both
  // consumers share `dashboardQueryKeys.organizations()`, so React Query
  // dedupes the network request.
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const { data, isLoading } = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
    enabled: !!session,
  });

  const orgs: Org[] = (data?.organizations as Org[]) ?? [];
  const currentOrg = orgs.find((o) => o.id === activeOrgId);

  // If a previous "Create organization…" attempt left an org row without a
  // bootstrapped profile (user dismissed the dialog after step 1), seed the
  // dialog at step 2 for that org instead of letting the user create a fresh
  // duplicate. Mirrors /onboarding's resume-triage. Radix unmounts dialog
  // content on close, so CreateOrgForm reads this seed fresh on each open.
  const incompleteOrg = orgs.find((o) => !o.hasBootstrappedProfile);
  const createDialogInitialOrg = incompleteOrg
    ? {
        orgId: incompleteOrg.id,
        orgName: incompleteOrg.name,
        orgSlug: incompleteOrg.slug,
        step: 1 as const,
      }
    : undefined;

  function handleSelect(org: Org): void {
    if (org.id !== activeOrgId) {
      setActiveOrg({ id: org.id, slug: org.slug, name: org.name, logo: org.logo });
      // Org-scoped queries are keyed by orgId (see dashboardQueryKeys.orgItems
      // / orgAgents / orgPermissions / orgAudit / etc.), so the new active
      // org's queries have completely different cache keys — they will mount
      // and fetch on first use without any invalidation. Old-org entries age
      // out via gcTime, which keeps back-navigation snappy if the user flips
      // between orgs. The previous nuke (`queryClient.invalidateQueries()`
      // with no key) caused a refetch storm across every cached query in the
      // app, including ones unrelated to org scope.
    }
  }

  // Show the skeleton placeholder when either the session itself is still
  // resolving OR the org-list query is in flight. For unauthenticated users
  // (session resolved as null), the skeleton stays up while DashboardGate
  // redirects to /login — better than briefly flashing a "Select org"
  // dropdown that the user is about to be navigated away from.
  if (sessionPending || !session || isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="pointer-events-none">
            <div className="flex aspect-square size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
              ...
            </div>
            <span className="truncate text-sm text-muted-foreground">Loading...</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <OrgIcon
                org={
                  currentOrg ?? {
                    id: "",
                    name: "?",
                    slug: "",
                    logo: null,
                    createdAt: "",
                    hasBootstrappedProfile: false,
                  }
                }
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{currentOrg?.name ?? "Select org"}</span>
                <span className="truncate text-xs">Organization</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => (
              <DropdownMenuItem key={org.id} onClick={() => handleSelect(org)} className="gap-2">
                <OrgIcon org={org} size="sm" />
                <span className="truncate">{org.name}</span>
                {org.id === activeOrgId && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                // Keep the dropdown from fighting the dialog for focus
                e.preventDefault();
                setCreateDialogOpen(true);
              }}
              className="gap-2"
            >
              <Building2 className="size-4" />
              <span>Create organization…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setJoinDialogOpen(true);
              }}
              className="gap-2"
            >
              <TicketCheck className="size-4" />
              <span>Join another organization…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        {/* Wider dialog: the two-step form has a progress bar plus form fields,
            and at the default width step 2 (storage mode picker + ZK password
            inputs) gets cramped. */}
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create an organization</DialogTitle>
            <DialogDescription>
              You'll be the owner. Set up an internal profile to start storing secrets.
            </DialogDescription>
          </DialogHeader>
          {/* CreateOrgForm sets the active org and invalidates the organizations
              list on success. We just need to close the dialog here. */}
          <CreateOrgForm
            variant="dialog"
            initialOrg={createDialogInitialOrg}
            onSuccess={() => {
              setCreateDialogOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join an organization</DialogTitle>
            <DialogDescription>
              Paste the invite link or code your admin shared with you.
            </DialogDescription>
          </DialogHeader>
          {/* InviteAcceptForm already sets the active org and invalidates the
              organizations list. Per-org queries are keyed on orgId, so they
              refetch naturally when activeOrgId changes — we just need to
              close the dialog here. */}
          <InviteAcceptForm
            variant="dialog"
            onSuccess={() => {
              setJoinDialogOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </SidebarMenu>
  );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
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
  const { activeOrgId, setActiveOrg } = useOrgStore();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
  });

  const orgs: Org[] = (data?.organizations as Org[]) ?? [];
  const currentOrg = orgs.find((o) => o.id === activeOrgId);

  function handleSelect(org: Org): void {
    if (org.id !== activeOrgId) {
      setActiveOrg({ id: org.id, slug: org.slug, name: org.name, logo: org.logo });
      // Invalidate all org-scoped queries so they refetch with the new org header
      queryClient.invalidateQueries();
    }
  }

  if (isLoading) {
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
                org={currentOrg ?? { id: "", name: "?", slug: "", logo: null, createdAt: "" }}
              />
              <span className="truncate text-sm font-medium">
                {currentOrg?.name ?? "Select org"}
              </span>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

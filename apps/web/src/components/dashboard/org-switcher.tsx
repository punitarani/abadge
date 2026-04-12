"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
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

export function OrgSwitcher(): React.ReactElement {
  const router = useRouter();
  const params = useParams<{ org: string }>();
  const currentSlug = params.org;

  const { data, isLoading } = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
  });

  const orgs: Org[] = (data?.organizations as Org[]) ?? [];
  const currentOrg = orgs.find((o) => o.slug === currentSlug);

  function handleSelect(org: Org): void {
    if (org.slug !== currentSlug) {
      router.push(`/${org.slug}/overview`);
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
              <div
                className={`flex aspect-square size-6 items-center justify-center rounded-full text-xs font-medium text-white ${currentOrg ? getOrgColor(currentOrg.name) : "bg-muted"}`}
              >
                {currentOrg ? getOrgInitial(currentOrg.name) : "?"}
              </div>
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
                <div
                  className={`flex aspect-square size-5 items-center justify-center rounded-full text-[10px] font-medium text-white ${getOrgColor(org.name)}`}
                >
                  {getOrgInitial(org.name)}
                </div>
                <span className="truncate">{org.name}</span>
                {org.slug === currentSlug && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

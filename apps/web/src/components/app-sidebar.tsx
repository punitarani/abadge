"use client";

import {
  BookOpen,
  Bot,
  Columns3,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { type PrefetchableRoute, useRoutePrefetcher } from "@/hooks/use-route-prefetcher";

const navGroups = [
  {
    label: "Secrets",
    items: [
      { path: "profiles", label: "Profiles", icon: Columns3 },
      { path: "items", label: "Items", icon: KeyRound },
    ],
  },
  {
    label: "Access",
    items: [
      { path: "agents", label: "Agents", icon: Bot },
      { path: "permissions", label: "Permissions", icon: ShieldCheck },
    ],
  },
  {
    label: "Monitor",
    items: [{ path: "audit", label: "Audit log", icon: ScrollText }],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  items: ReadonlyArray<{ path: PrefetchableRoute; label: string; icon: typeof Columns3 }>;
}>;

const secondaryNavItems = [
  { path: "support", label: "Support", icon: LifeBuoy },
  { path: "feedback", label: "Feedback", icon: Send },
] as const;

const bottomNavItems = [{ path: "settings", label: "Settings", icon: Settings }] as const;

/**
 * Pointer/focus handlers wired to a route's prefetcher. We fire on both
 * pointerenter (mouse hover) and focus (keyboard tab) so keyboard-only users
 * get the same warm-cache benefit as mouse users.
 */
function usePrefetchHandlers(prefetch: () => void): {
  onPointerEnter: () => void;
  onFocus: () => void;
} {
  return useMemo(() => ({ onPointerEnter: prefetch, onFocus: prefetch }), [prefetch]);
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>): React.ReactElement {
  const pathname = usePathname();
  const prefetchers = useRoutePrefetcher();

  const overviewHandlers = usePrefetchHandlers(prefetchers.overview);
  const settingsHandlers = usePrefetchHandlers(prefetchers.settings);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {/* Overview — standalone at top */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/overview")}>
                  <Link href="/overview" {...overviewHandlers}>
                    <LayoutDashboard />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Grouped nav sections */}
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    path={item.path}
                    label={item.label}
                    icon={item.icon}
                    pathname={pathname}
                    prefetch={prefetchers[item.path]}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {/* Secondary nav + Settings — pushed to bottom */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="https://docs.abadge.io" target="_blank" rel="noopener noreferrer">
                    <BookOpen />
                    <span>Docs</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {secondaryNavItems.map((item) => {
                const href = `/${item.path}`;
                const isActive = pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {bottomNavItems.map((item) => {
                const href = `/${item.path}`;
                const isActive = pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={href} {...settingsHandlers}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function NavLink({
  path,
  label,
  icon: Icon,
  pathname,
  prefetch,
}: {
  path: PrefetchableRoute;
  label: string;
  icon: typeof Columns3;
  pathname: string;
  prefetch: () => void;
}): React.ReactElement {
  const href = `/${path}`;
  const isActive = pathname.startsWith(href);
  const handlers = usePrefetchHandlers(prefetch);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link href={href} {...handlers}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

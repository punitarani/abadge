"use client";

import {
  BookOpen,
  Bot,
  Columns3,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
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
  useSidebar,
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
  items: ReadonlyArray<{ path: PrefetchableRoute; label: string; icon: LucideIcon }>;
}>;

const secondaryNavItems = [
  { href: "mailto:support@abadge.io", label: "Support", icon: LifeBuoy },
  { href: "https://abadge.userjot.com/", label: "Feedback", icon: Send },
] as const;

const bottomNavItems = [{ path: "settings", label: "Settings", icon: Settings }] as const;

/**
 * "Settle"-style hover/focus debounce: prefetch fires only if the user stays
 * on the link for `HOVER_DEBOUNCE_MS`, and cancels if they move on first.
 * This avoids wasted requests when the cursor grazes the link en route to
 * another target. TanStack Query's dedupe would handle request amplification
 * but does not help with the bandwidth cost of an unnecessary first request.
 */
const HOVER_DEBOUNCE_MS = 100;

interface PrefetchHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

function usePrefetchHandlers(prefetch: () => void): PrefetchHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      prefetch();
    }, HOVER_DEBOUNCE_MS);
  }, [prefetch, cancel]);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerEnter: start,
    onPointerLeave: cancel,
    onFocus: start,
    onBlur: cancel,
  };
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>): React.ReactElement {
  const pathname = usePathname();
  const prefetchers = useRoutePrefetcher();
  // On mobile the sidebar is an off-canvas Sheet; close it after a navigation
  // so the destination page isn't left hidden behind the open drawer.
  const { setOpenMobile } = useSidebar();
  const closeMobile = useCallback(() => setOpenMobile(false), [setOpenMobile]);

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
                  <Link href="/overview" {...overviewHandlers} onClick={closeMobile}>
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
                    onNavigate={closeMobile}
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
                const isMailto = item.href.startsWith("mailto:");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild>
                      <a
                        href={item.href}
                        {...(isMailto ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </a>
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
                      <Link href={href} {...settingsHandlers} onClick={closeMobile}>
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
  onNavigate,
}: {
  path: PrefetchableRoute;
  label: string;
  icon: LucideIcon;
  pathname: string;
  prefetch: () => void;
  onNavigate?: () => void;
}): React.ReactElement {
  const href = `/${path}`;
  const isActive = pathname.startsWith(href);
  const handlers = usePrefetchHandlers(prefetch);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link href={href} {...handlers} onClick={onNavigate}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

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
];

const secondaryNavItems = [
  { path: "support", label: "Support", icon: LifeBuoy },
  { path: "feedback", label: "Feedback", icon: Send },
];

const bottomNavItems = [{ path: "settings", label: "Settings", icon: Settings }];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>): React.ReactElement {
  const pathname = usePathname();

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
                  <Link href="/overview">
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
                {group.items.map((item) => {
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
                      <Link href={href}>
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

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  Bot,
  Building2,
  ChevronsUpDown,
  Columns3,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { MobileHeader } from "./mobile-header";

/**
 * Visual reference for the mobile dashboard navigation. Below the `md`
 * breakpoint the sidebar collapses to an off-canvas Sheet; `MobileHeader`
 * exposes the trigger that opens it. The surrounding sidebar/footer here mirror
 * the production chrome so the drawer screenshots look representative.
 */
const NAV: ReadonlyArray<{ label: string; icon: LucideIcon }> = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Profiles", icon: Columns3 },
  { label: "Items", icon: KeyRound },
  { label: "Agents", icon: Bot },
  { label: "Permissions", icon: ShieldCheck },
  { label: "Audit log", icon: ScrollText },
];

function MobileShell(): React.ReactElement {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                  <Building2 className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Acme Inc</span>
                  <span className="truncate text-xs text-muted-foreground">Organization</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.slice(0, 1).map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton isActive>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Secrets</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.slice(1, 3).map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Access</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.slice(3, 5).map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Monitor</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.slice(5).map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Settings />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">AD</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Ada Lovelace</span>
                  <span className="truncate text-xs">ada@acme.inc</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <MobileHeader />
        <div className="px-4 py-6 sm:px-6 md:px-8">
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Thursday, May 28, 2026</p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            {["Profiles", "Items", "Agents", "Permissions"].map((label) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="mt-2 text-3xl font-bold">2</div>
              </div>
            ))}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

const meta = {
  title: "Dashboard/MobileNavigation",
  component: MobileShell,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/overview" } },
  },
} satisfies Meta<typeof MobileShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

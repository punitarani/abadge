import {
  Bot,
  Columns3,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { PrefetchableRoute } from "@/hooks/use-route-prefetcher";

export interface NavItem {
  readonly path: PrefetchableRoute;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface NavGroup {
  readonly label: string;
  readonly items: ReadonlyArray<NavItem>;
}

/** Single source of truth for the dashboard's primary navigation. Both the
 * desktop sidebar (`app-sidebar`) and the mobile header (`mobile-header`)
 * derive their labels/routes from here, so a renamed or added route updates
 * everywhere at once. */
export const overviewNavItem: NavItem = {
  path: "overview",
  label: "Overview",
  icon: LayoutDashboard,
};

export const navGroups: ReadonlyArray<NavGroup> = [
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

export const settingsNavItem: NavItem = {
  path: "settings",
  label: "Settings",
  icon: Settings,
};

/** Maps a top-level path segment to its human-readable label, derived from the
 * nav config above so it can never drift from the sidebar. */
export const navLabelBySegment: Readonly<Record<string, string>> = Object.fromEntries(
  [overviewNavItem, ...navGroups.flatMap((group) => group.items), settingsNavItem].map((item) => [
    item.path,
    item.label,
  ]),
);

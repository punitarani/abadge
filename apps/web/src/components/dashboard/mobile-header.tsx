"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Human titles for the dashboard's top-level routes, keyed by first path
 * segment. Mirrors the nav entries in `app-sidebar`. Unknown segments fall back
 * to a title-cased version of the segment so a new page is never left blank.
 */
const ROUTE_TITLES: Record<string, string> = {
  overview: "Overview",
  profiles: "Profiles",
  items: "Items",
  agents: "Agents",
  permissions: "Permissions",
  audit: "Audit log",
  settings: "Settings",
};

function titleForPath(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) {
    return "abadge";
  }
  return ROUTE_TITLES[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * Mobile-only top bar. On screens below `md` the desktop sidebar is rendered as
 * an off-canvas Sheet (see `ui/sidebar`), but nothing exposed a way to open it —
 * mobile users were stranded on whatever page loaded with no navigation. This
 * sticky, blurred header surfaces the menu trigger and shows the current page
 * title for orientation. Hidden at `md` and up, where the persistent sidebar
 * takes over.
 */
export function MobileHeader(): React.ReactElement {
  const { toggleSidebar } = useSidebar();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 md:hidden">
      <Button variant="ghost" size="icon" aria-label="Open navigation menu" onClick={toggleSidebar}>
        <Menu className="size-5" />
      </Button>
      <span className="truncate font-semibold tracking-tight text-foreground">
        {titleForPath(pathname)}
      </span>
    </header>
  );
}

"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { navLabelBySegment } from "@/components/dashboard/nav-config";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Resolve the current page's title from its first path segment, reusing the
 * shared nav labels so the header can never drift from the sidebar. Unknown
 * segments title-case the segment so a new page is never left blank.
 */
function titleForPath(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) {
    return "abadge";
  }
  return navLabelBySegment[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
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
  const { toggleSidebar, openMobile } = useSidebar();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={openMobile ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={openMobile}
        onClick={toggleSidebar}
      >
        <Menu className="size-5" />
      </Button>
      <span className="truncate font-semibold tracking-tight text-foreground">
        {titleForPath(pathname)}
      </span>
    </header>
  );
}

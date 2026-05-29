"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Mobile-only top bar. On screens below `md` the desktop sidebar is rendered as
 * an off-canvas Sheet (see `ui/sidebar`), but nothing exposed a way to open it —
 * mobile users were stranded on whatever page loaded with no navigation. This
 * sticky, blurred header surfaces the menu trigger and keeps the brand anchored.
 * Hidden at `md` and up, where the persistent sidebar takes over.
 */
export function MobileHeader(): React.ReactElement {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 md:hidden">
      <Button variant="ghost" size="icon" aria-label="Open navigation menu" onClick={toggleSidebar}>
        <Menu className="size-5" />
      </Button>
      <Link href="/overview" className="font-semibold tracking-tight text-foreground">
        abadge
      </Link>
    </header>
  );
}

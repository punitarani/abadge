"use client";

import type * as React from "react";
import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

let activeOverlayCount = 0;

function setUserJotWidgetEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  const uj = (
    window as Window & {
      uj?: {
        hideWidget?: () => void;
        setWidgetEnabled?: (enabled: boolean) => void;
      };
    }
  ).uj;

  uj?.setWidgetEnabled?.(enabled);

  if (!enabled) {
    uj?.hideWidget?.();
  }
}

interface ResponsiveOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "left" | "right";
  contentClassName?: string;
  bodyClassName?: string;
  forceMobile?: boolean;
  showCloseButton?: boolean;
}

function OverlayFrame({
  children,
  bodyClassName,
}: Pick<ResponsiveOverlayProps, "children" | "bodyClassName">): React.ReactElement {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", bodyClassName)}>{children}</div>;
}

export function ResponsiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  contentClassName,
  bodyClassName,
  forceMobile,
  showCloseButton = true,
}: ResponsiveOverlayProps): React.ReactElement {
  const detectedIsMobile = useIsMobile();
  const isMobile = forceMobile ?? detectedIsMobile;

  useEffect(() => {
    if (!open) {
      return;
    }

    activeOverlayCount += 1;
    setUserJotWidgetEnabled(false);

    return () => {
      activeOverlayCount = Math.max(0, activeOverlayCount - 1);

      if (activeOverlayCount === 0) {
        setUserJotWidgetEnabled(true);
      }
    };
  }, [open]);

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          variant="bottom-sheet"
          showCloseButton={showCloseButton}
          className={cn("flex h-auto max-h-[85vh] flex-col", contentClassName)}
        >
          <DialogHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
            <DialogTitle className="pr-10">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <OverlayFrame bodyClassName={bodyClassName}>{children}</OverlayFrame>
          {footer ? (
            <DialogFooter className="sticky bottom-0 border-t border-border bg-background p-4 sm:flex-row">
              {footer}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn("flex w-full flex-col p-0 sm:max-w-2xl", contentClassName)}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="pr-10">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <OverlayFrame bodyClassName={bodyClassName}>{children}</OverlayFrame>
        {footer ? (
          <SheetFooter className="border-t border-border bg-background p-4">{footer}</SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

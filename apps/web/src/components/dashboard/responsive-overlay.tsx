"use client";

import type * as React from "react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

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
  title,
  description,
  children,
  footer,
  bodyClassName,
  paddingClassName = "p-5",
}: Pick<
  ResponsiveOverlayProps,
  "title" | "description" | "children" | "footer" | "bodyClassName"
> & {
  paddingClassName?: string;
}): React.ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className={cn("flex flex-col gap-1.5 border-b border-border p-4", paddingClassName)}>
        <div className="pr-10">
          <div className="font-semibold text-foreground">{title}</div>
          <div className="text-sm text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-5", bodyClassName)}>{children}</div>
      {footer ? <div className="border-t border-border p-4">{footer}</div> : null}
    </div>
  );
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

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerContent className={cn("max-h-[85vh] p-0", contentClassName)}>
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <OverlayFrame
            title={title}
            description={description}
            footer={footer}
            bodyClassName={bodyClassName}
            paddingClassName="px-5 pb-4 pt-2"
          >
            {children}
          </OverlayFrame>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={showCloseButton}
        className={cn("w-full p-0 sm:max-w-2xl", contentClassName)}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        <OverlayFrame
          title={title}
          description={description}
          footer={footer}
          bodyClassName={bodyClassName}
        >
          {children}
        </OverlayFrame>
      </SheetContent>
    </Sheet>
  );
}

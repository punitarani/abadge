import type * as React from "react";
import { cn } from "@/lib/utils";

interface DashboardPanelPageProps {
  title: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerAction?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  maxWidthClassName?: string;
}

export function DashboardPanelPage({
  title,
  description,
  children,
  footer,
  headerAction,
  className,
  bodyClassName,
  maxWidthClassName = "max-w-lg",
}: DashboardPanelPageProps): React.ReactElement {
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", maxWidthClassName, className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {headerAction}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className={cn("flex flex-col gap-5 p-5", bodyClassName)}>{children}</div>
        {footer ? <div className="border-t border-border p-4">{footer}</div> : null}
      </div>
    </div>
  );
}

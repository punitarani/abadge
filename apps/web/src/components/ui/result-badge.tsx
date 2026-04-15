import type { AuditResult } from "@abadge/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "destructive" | "warning" | "secondary" | "outline";

const RESULT_VARIANTS: Record<AuditResult, BadgeVariant> = {
  allowed: "success",
  denied: "destructive",
  expired: "warning",
  revoked: "warning",
  cascade: "outline",
};

const RESULT_CLASS_OVERRIDES: Partial<Record<AuditResult, string>> = {
  cascade:
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300 border-transparent",
};

interface ResultBadgeProps {
  result: AuditResult;
  className?: string;
}

export function ResultBadge({ result, className }: ResultBadgeProps): React.ReactElement {
  const variant = RESULT_VARIANTS[result];
  const override = RESULT_CLASS_OVERRIDES[result];

  return (
    <Badge variant={variant} className={cn(override, className)}>
      {result}
    </Badge>
  );
}

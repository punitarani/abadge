import { Badge } from "@/components/ui/badge";

type BadgeVariant = "success" | "destructive" | "warning" | "secondary";

const RESULT_VARIANTS: Record<string, BadgeVariant> = {
  allowed: "success",
  denied: "destructive",
  expired: "warning",
  revoked: "warning",
};

interface ResultBadgeProps {
  result: string;
  className?: string;
}

export function ResultBadge({ result, className }: ResultBadgeProps): React.ReactElement {
  const variant = RESULT_VARIANTS[result] ?? "secondary";

  return (
    <Badge variant={variant} className={className}>
      {result}
    </Badge>
  );
}

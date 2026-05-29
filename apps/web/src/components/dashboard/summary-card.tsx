import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SummaryCardProps {
  label: string;
  value: string | number;
  subtitle: string;
  /**
   * When true the value and subtitle render as skeletons. The label — known
   * ahead of the data — stays visible so the card never looks empty and the
   * height matches the loaded card exactly (no reflow when data arrives).
   */
  loading?: boolean;
}

export function SummaryCard({
  label,
  value,
  subtitle,
  loading = false,
}: SummaryCardProps): React.ReactElement {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {loading ? (
          <Skeleton className="my-1 h-7 w-12" />
        ) : (
          <p className="text-3xl font-bold">{value}</p>
        )}
        {loading ? (
          <Skeleton className="h-4 w-28" />
        ) : (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

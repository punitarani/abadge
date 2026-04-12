import { Card, CardContent } from "@/components/ui/card";

interface SummaryCardProps {
  label: string;
  value: string | number;
  subtitle: string;
}

export function SummaryCard({ label, value, subtitle }: SummaryCardProps): React.ReactElement {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

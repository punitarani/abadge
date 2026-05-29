import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Skeleton rows for a settings table body (members, API keys). Rendered inside
 * a real `<TableBody>` so the column widths line up exactly with the loaded
 * table — the loading state never shifts the layout when data arrives. The
 * trailing column mimics the right-aligned row action (Remove / Revoke).
 */
export function SettingsTableRowsSkeleton({
  rows = 3,
  columns,
}: {
  rows?: number;
  columns: number;
}): React.ReactElement {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
        <TableRow key={rowIdx} className="hover:bg-transparent">
          {Array.from({ length: columns }).map((_, colIdx) => {
            const isLast = colIdx === columns - 1;
            return (
              <TableCell
                // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                key={colIdx}
                className={isLast ? "text-right" : undefined}
              >
                {isLast ? (
                  <Skeleton className="ml-auto h-8 w-16" />
                ) : (
                  <Skeleton
                    className="h-4"
                    style={{
                      width: colIdx === 0 ? "65%" : `${45 + ((rowIdx + colIdx) % 3) * 12}%`,
                    }}
                  />
                )}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
    </>
  );
}

/** Header + skeleton body for a settings table, matching the loaded chrome. */
function SettingsTableSkeleton({ columns }: { columns: number }): React.ReactElement {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: columns }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
              <TableHead key={i}>
                <Skeleton className="h-3.5 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <SettingsTableRowsSkeleton rows={3} columns={columns} />
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Full-page skeleton for the settings route. Mirrors the real layout exactly
 * — `max-w-3xl space-y-8` wrapper, breadcrumb, header, account card, the API
 * keys table + create card, and the danger zone — so the transition from the
 * route-level fallback to the rendered page is seamless rather than a reflow.
 * The conditional members table (team orgs only) is intentionally omitted: the
 * page renders its own header and per-section states the instant it mounts.
 */
export function SettingsSkeleton(): React.ReactElement {
  return (
    <div className="max-w-3xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-1.5 opacity-60" />
        <Skeleton className="h-4 w-16" />
      </div>

      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Account */}
      <section className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Card className="p-5">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-full max-w-sm" />
                <Skeleton className="h-9 w-16" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full max-w-sm" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
        </Card>
      </section>

      {/* API keys */}
      <section className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-full max-w-xl" />
        </div>
        <SettingsTableSkeleton columns={6} />
        <Card className="p-5">
          <div className="space-y-4">
            <div className="space-y-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-72" />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-9 w-56" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-9 w-32" />
              </div>
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        </Card>
      </section>

      {/* Danger zone */}
      <section className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
          <Skeleton className="mb-4 h-4 w-80" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </section>
    </div>
  );
}

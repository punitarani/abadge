import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  /** Breadcrumb visibility (list pages get a breadcrumb). */
  breadcrumb?: boolean;
  /** Number of filter controls in the toolbar (search counts as one). */
  filterCount?: number;
  /** Whether to show a primary action button on the right. */
  action?: boolean;
  /** Number of skeleton rows in the table. */
  rowCount?: number;
  /** Number of columns in the table. */
  columnCount?: number;
}

export function TableSkeleton({
  breadcrumb = true,
  filterCount = 2,
  action = true,
  rowCount = 8,
  columnCount = 5,
}: TableSkeletonProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {breadcrumb && (
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-2 opacity-60" />
          <Skeleton className="h-4 w-16" />
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        {action && <Skeleton className="h-8 w-28" />}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-64" />
        {Array.from({ length: Math.max(0, filterCount - 1) }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border bg-muted/40 p-3">
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columnCount }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rowCount }).map((_, rowIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
            <div key={rowIdx} className="p-3">
              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: columnCount }).map((_, colIdx) => (
                  <Skeleton
                    // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                    key={colIdx}
                    className="h-4"
                    style={{ width: colIdx === 0 ? "75%" : `${55 + ((rowIdx + colIdx) % 4) * 8}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

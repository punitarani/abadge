import { Skeleton } from "@/components/ui/skeleton";

interface CardsSkeletonProps {
  /** Number of summary cards. Overview page renders 5. */
  cardCount?: number;
  /** Whether to render the recent-events table below the cards. */
  withRecentTable?: boolean;
}

export function CardsSkeleton({
  cardCount = 5,
  withRecentTable = true,
}: CardsSkeletonProps): React.ReactElement {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="rounded-md border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
        <Skeleton className="h-4 w-3/4 bg-emerald-200/40 dark:bg-emerald-900/40" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: cardCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
          <div key={i} className="rounded-lg border border-border p-4 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
            <Skeleton key={i} className="h-8 w-32" />
          ))}
        </div>
      </div>

      {withRecentTable && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <div className="border-b border-border bg-muted/40 p-3">
              <div className="grid grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                  <Skeleton key={i} className="h-4" />
                ))}
              </div>
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, rowIdx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                <div key={rowIdx} className="grid grid-cols-6 gap-4 p-3">
                  {Array.from({ length: 6 }).map((_, colIdx) => (
                    <Skeleton
                      // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                      key={colIdx}
                      className="h-4"
                      style={{ width: `${55 + ((rowIdx + colIdx) % 4) * 10}%` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

interface DetailSkeletonProps {
  /** Number of metadata cards in the top grid. */
  metadataCount?: number;
  /** Number of nested table sections under the metadata. */
  sectionCount?: number;
}

export function DetailSkeleton({
  metadataCount = 4,
  sectionCount = 2,
}: DetailSkeletonProps): React.ReactElement {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-2 opacity-60" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-2 opacity-60" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: metadataCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
          <div key={i} className="rounded-lg border border-border px-4 py-3 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      {Array.from({ length: sectionCount }).map((_, sectionIdx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
        <div key={sectionIdx} className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="overflow-hidden rounded-md border border-border">
            <div className="border-b border-border bg-muted/40 p-3">
              <div className="grid grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                  <Skeleton key={i} className="h-4" />
                ))}
              </div>
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, rowIdx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                <div key={rowIdx} className="grid grid-cols-4 gap-4 p-3">
                  {Array.from({ length: 4 }).map((_, colIdx) => (
                    <Skeleton
                      // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
                      key={colIdx}
                      className="h-4"
                      style={{
                        width: colIdx === 0 ? "70%" : `${60 + ((rowIdx + colIdx) % 3) * 10}%`,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

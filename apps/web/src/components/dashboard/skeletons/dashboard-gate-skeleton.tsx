import { Skeleton } from "@/components/ui/skeleton";

/**
 * Neutral, route-agnostic skeleton shown by the dashboard auth/org gate while
 * the session, org list, and persisted store hydrate. It deliberately doesn't
 * mimic any one page — the gate runs before the destination route is known — so
 * a header plus a stat grid reads as "dashboard loading" without committing to
 * a layout. Each route's own `loading.tsx` / inline skeletons take over the
 * moment the gate passes.
 */
export function DashboardGateSkeleton(): React.ReactElement {
  return (
    <div className="space-y-8" role="status" aria-busy="true">
      <span className="sr-only">Loading your workspace…</span>
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order-stable, length-stable skeleton
          <div key={i} className="space-y-3 rounded-lg border border-border p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

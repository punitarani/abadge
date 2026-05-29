import Image from "next/image";

/**
 * Brand loader shown by the dashboard gate while the session and active org
 * hydrate. The destination route isn't known yet, so a centered abadge mark
 * with the wordmark unfurling out of it reads as "workspace loading" honestly,
 * without faking a page layout — once the gate passes, each route's own
 * page-representative skeleton (its `loading.tsx` plus the in-table shimmer)
 * takes over.
 *
 * The wordmark animates via `clip-path` (see `logo-reveal` in globals.css), so
 * it keeps its full layout width while only the paint is revealed — the mark
 * and wordmark stay centered as a unit with no reflow. `motion-reduce` users
 * get the static lockup.
 */
export function DashboardLoading(): React.ReactElement {
  return (
    <div className="flex min-h-[70vh] items-center justify-center" role="status" aria-busy="true">
      {/* Decorative lockup — hidden from the a11y tree so the status announces
          only the sr-only string, not the visible "abadge" wordmark. */}
      <div className="flex items-center gap-2" aria-hidden="true">
        <Image
          src="/abadge-logo-black.svg"
          alt=""
          width={32}
          height={32}
          priority
          className="size-8 shrink-0 dark:invert"
        />
        <span className="text-2xl font-bold tracking-[-0.04em] text-foreground motion-safe:animate-logo-reveal">
          abadge
        </span>
      </div>
      <span className="sr-only">Loading your workspace…</span>
    </div>
  );
}

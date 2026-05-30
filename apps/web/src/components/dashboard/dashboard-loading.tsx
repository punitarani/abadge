import { AnimatedAbadgeLogo } from "@/components/animated-abadge-logo";

/**
 * Brand loader shown by the dashboard gate while the session and active org
 * hydrate. The destination route isn't known yet, so a centered abadge brand
 * reveal reads as "workspace loading" honestly, without faking a page layout —
 * once the gate passes, each route's own page-representative skeleton takes
 * over. It loops as a gentle breathing cue so a slow gate still reads as active;
 * `prefers-reduced-motion` users get the static lockup.
 */
export function DashboardLoading(): React.ReactElement {
  return (
    <div
      className="flex min-h-[70vh] items-center justify-center p-6"
      role="status"
      aria-busy="true"
    >
      {/* Decorative reveal — hidden from the a11y tree so the status announces
          only the sr-only string, not the visible "abadge" wordmark. */}
      <div aria-hidden="true" className="w-full max-w-md">
        <AnimatedAbadgeLogo loop className="rounded-xl" />
      </div>
      <span className="sr-only">Loading your workspace…</span>
    </div>
  );
}

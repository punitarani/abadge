import Image from "next/image";

/**
 * Brand loader shown by the dashboard gate while the session and active org
 * hydrate. The destination route isn't known yet.
 *
 * Animation (motion-safe only): logo starts centered alone, then slides left
 * while the wordmark rolls out to the right from behind it — a curtain-open
 * effect. Both elements reverse back at the end of each cycle. See
 * `loader-logo` / `loader-text` in globals.css. `motion-reduce` users get
 * the static lockup with no transforms.
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
          className="size-8 shrink-0 dark:invert motion-safe:animate-loader-logo"
        />
        <span className="text-2xl font-bold tracking-[-0.04em] text-foreground motion-safe:animate-loader-text">
          abadge
        </span>
      </div>
      <span className="sr-only">Loading your workspace…</span>
    </div>
  );
}

import Image from "next/image";
import { cn } from "@/lib/utils";

type AbadgeLogoSize = "sm" | "md" | "lg";

interface AnimatedAbadgeLogoProps {
  /** Extra classes on the lockup (e.g. sizing or colour overrides). */
  className?: string;
  /** Play the reveal on mount. When false, renders the static final lockup. */
  autoPlay?: boolean;
  /** Loop as a gentle reveal/conceal breathing cycle instead of playing once. */
  loop?: boolean;
  /** Scale of the lockup. */
  size?: AbadgeLogoSize;
}

/**
 * Animated abadge logo lockup: the icon starts centred alone, slides left, and
 * the "abadge" wordmark unfurls left→right out of its edge (clip-path) with a
 * subtle scale pop.
 *
 * Frameless and transparent — it sits plainly on whatever background it's placed
 * on and adapts to the theme (the icon inverts in dark mode; the wordmark uses
 * the foreground colour). Pure CSS (`abadge-logo-*` keyframes in globals.css);
 * `prefers-reduced-motion` users get the static final lockup. Decorative by
 * default — wrap with a11y semantics (e.g. `role="status"`) at the call site.
 */
export function AnimatedAbadgeLogo({
  className,
  autoPlay = true,
  loop = false,
  size = "md",
}: AnimatedAbadgeLogoProps): React.ReactElement {
  // font-size drives every other dimension (icon, gap, and the centring shift
  // are all em). A vw clamp keeps the lockup proportionate from phone to desktop
  // without needing a sized container.
  const fontSize = {
    sm: "clamp(1.1rem, 5.5vw, 1.85rem)",
    md: "clamp(1.6rem, 8vw, 2.75rem)",
    lg: "clamp(2rem, 10vw, 3.5rem)",
  }[size];

  return (
    <div
      data-abadge-logo=""
      data-play={autoPlay ? "true" : "false"}
      data-loop={loop ? "true" : "false"}
      className={cn("inline-flex items-center", className)}
      style={{ fontSize, gap: "0.32em" }}
    >
      <Image
        src="/abadge-icon-black.svg"
        alt=""
        width={512}
        height={512}
        priority
        draggable={false}
        className="abadge-logo__icon shrink-0 select-none dark:invert"
        style={{ height: "1.06em", width: "1.06em" }}
      />
      {/* origin-left anchors the scale pop to the icon side as the wordmark
          unfurls out of the icon's edge. */}
      <span
        className="abadge-logo__text origin-left font-sans font-bold lowercase leading-none text-foreground"
        style={{ letterSpacing: "-0.04em" }}
      >
        abadge
      </span>
    </div>
  );
}

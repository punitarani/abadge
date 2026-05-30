import Image from "next/image";
import { cn } from "@/lib/utils";

type AbadgeLogoSize = "sm" | "md" | "lg";

interface AnimatedAbadgeLogoProps {
  /** Extra classes on the 16:9 frame (e.g. `rounded-xl`, sizing constraints). */
  className?: string;
  /** Play the reveal on mount. When false, renders the static final lockup. */
  autoPlay?: boolean;
  /** Loop as a gentle reveal/conceal breathing cycle instead of playing once. */
  loop?: boolean;
  /** Scale of the lockup relative to the frame width. */
  size?: AbadgeLogoSize;
}

/**
 * Brand reveal: the off-white icon starts centered alone in a 16:9 black frame,
 * slides left, and the "abadge" wordmark wipes out from behind its right edge
 * with a subtle scale pop — a polished lockup reveal, not a generic fade.
 *
 * The whole composition scales with the frame via container-query units, so it
 * stays proportional on desktop and mobile. The animation is pure CSS
 * (`abadge-logo-*` keyframes in globals.css); `prefers-reduced-motion` users get
 * the static final lockup. Decorative by default — wrap with the appropriate
 * a11y semantics (e.g. `role="status"`) at the call site.
 */
export function AnimatedAbadgeLogo({
  className,
  autoPlay = true,
  loop = false,
  size = "md",
}: AnimatedAbadgeLogoProps): React.ReactElement {
  // font-size drives every other dimension (icon, gap, shift are all em), so the
  // lockup scales as one unit. cqi keeps it proportional to the frame; clamp
  // guards the extremes on tiny and very wide containers.
  const fontSize = {
    sm: "clamp(0.85rem, 10cqi, 3rem)",
    md: "clamp(1.05rem, 13cqi, 4.5rem)",
    lg: "clamp(1.3rem, 16cqi, 6rem)",
  }[size];

  return (
    <div
      data-abadge-logo=""
      data-play={autoPlay ? "true" : "false"}
      data-loop={loop ? "true" : "false"}
      className={cn("@container relative aspect-[16/9] w-full overflow-hidden bg-black", className)}
    >
      <div className="absolute inset-0 grid place-items-center" style={{ fontSize }}>
        <div className="flex items-center" style={{ gap: "0.32em" }}>
          <Image
            src="/abadge-icon-white.svg"
            alt=""
            width={512}
            height={512}
            priority
            draggable={false}
            className="abadge-logo__icon shrink-0 select-none"
            style={{ height: "1.06em", width: "1.06em" }}
          />
          {/* The wordmark unfurls left→right out of the icon's edge (clip-path),
              nudging right with a subtle scale pop. origin-left anchors the pop
              to the icon side. */}
          <span
            className="abadge-logo__text origin-left font-sans font-bold lowercase leading-none text-[#efefef]"
            style={{ letterSpacing: "-0.04em" }}
          >
            abadge
          </span>
        </div>
      </div>
    </div>
  );
}

import type { Capability } from "@abadge/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CAPABILITY_STYLES: Record<Capability, string> = {
  reveal_plaintext: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  read_ciphertext: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  mount_env: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  mount_file: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

interface CapabilityBadgeProps {
  capability: Capability;
  className?: string;
}

export function CapabilityBadge({
  capability,
  className,
}: CapabilityBadgeProps): React.ReactElement {
  const style = CAPABILITY_STYLES[capability];

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-mono text-[11px]", style, className)}
    >
      {capability}
    </Badge>
  );
}

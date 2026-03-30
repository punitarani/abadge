import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-neutral-800",
        destructive: "bg-white text-destructive border border-destructive/30 hover:bg-red-50",
        outline: "bg-white text-foreground border border-input hover:bg-neutral-50",
        secondary:
          "bg-secondary text-secondary-foreground border border-input hover:bg-neutral-100",
        ghost: "text-muted-foreground hover:bg-neutral-100 hover:text-foreground",
        link: "text-link underline-offset-4 hover:underline font-medium",
      },
      size: {
        default: "h-[34px] px-4",
        sm: "h-[28px] px-3 text-xs",
        lg: "h-[38px] px-5",
        icon: "h-[34px] w-[34px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

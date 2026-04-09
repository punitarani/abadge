"use client";

import { OTPInput, OTPInputContext } from "input-otp";
import { Minus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn("flex items-center gap-2 has-disabled:opacity-50", containerClassName)}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-group" className={cn("flex items-center", className)} {...props} />
  );
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & { index: number }) {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots?.[index] ?? {};

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      data-has-fake-caret={hasFakeCaret}
      className={cn(
        "relative flex h-11 w-10 items-center justify-center border-y border-r border-input font-mono text-base font-semibold uppercase tracking-widest shadow-xs transition-all first:rounded-l-lg first:border-l last:rounded-r-lg",
        "outline-none",
        isActive && "z-10 border-ring ring-3 ring-ring/30",
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink h-5 w-px bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-separator" aria-hidden="true" {...props}>
      <Minus className="size-4 text-muted-foreground" />
    </div>
  );
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };

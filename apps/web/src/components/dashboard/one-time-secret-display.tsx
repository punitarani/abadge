"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface OneTimeSecretDisplayProps {
  value: string;
  type: "bootstrap_token" | "api_key";
  expiresAt?: string;
  onDismiss: () => void;
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "Expired";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} remaining`;
}

export function OneTimeSecretDisplay({
  value,
  type,
  expiresAt,
  onDismiss,
}: OneTimeSecretDisplayProps): React.ReactElement {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [remainingMs, setRemainingMs] = useState<number | null>(() => {
    if (!expiresAt) return null;
    return Math.max(0, new Date(expiresAt).getTime() - Date.now());
  });

  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemainingMs(ms);
      if (ms <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  // Covered by one-time-secret-display.test.tsx (B12 rejection path).
  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      setTimeout(() => setCopyState((s) => (s === "copied" ? "idle" : s)), 2000);
    } catch {
      setCopyState("error");
      toast.error(
        "Couldn't copy — select the value and copy manually (secure context may be required).",
      );
    }
  }

  const label = type === "bootstrap_token" ? "Bootstrap Token" : "API Key";
  const isExpired = remainingMs !== null && remainingMs <= 0;

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted p-3">
        <code className="flex-1 break-all font-mono text-sm">{value}</code>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-label={
            copyState === "copied"
              ? "Copied to clipboard"
              : copyState === "error"
                ? "Copy failed — select manually"
                : "Copy to clipboard"
          }
        >
          {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
        </Button>
      </div>

      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
        This will not be shown again.
      </div>

      {type === "bootstrap_token" && remainingMs !== null && (
        <div
          className={`text-sm font-medium ${isExpired ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
        >
          {formatCountdown(remainingMs)}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={onDismiss} className="w-full">
        Dismiss
      </Button>
    </div>
  );
}

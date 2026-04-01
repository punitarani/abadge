"use client";

import { useState } from "react";
import { Button } from "./button";

interface SecretDisplayProps {
  value: string;
  warning?: string;
}

/** Shows a secret value with a copy button and an optional warning banner. */
export function SecretDisplay({
  value,
  warning = "This key will not be shown again. Store it securely.",
}: SecretDisplayProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="bg-neutral-50 border border-border rounded-md p-3 flex items-start justify-between gap-3">
        <code className="text-sm font-mono break-all flex-1">{value}</code>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {warning && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {warning}
        </div>
      )}
    </div>
  );
}

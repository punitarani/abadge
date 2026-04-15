"use client";

import type React from "react";
import { useRef } from "react";

export type StorageMode = "zero_knowledge" | "server_managed";

export interface StorageModePickerProps {
  value: StorageMode;
  onChange: (next: StorageMode) => void;
  disabled?: boolean;
}

const OPTIONS = [
  {
    value: "zero_knowledge" as const,
    label: "Zero-knowledge",
    description:
      "Items are encrypted client-side. The server never sees plaintext or your root key.",
  },
  {
    value: "server_managed" as const,
    label: "Server-managed",
    description:
      "Items are encrypted server-side with AES-256-GCM. Simpler setup, no client-side crypto.",
  },
];

const LABEL_ID = "storage-mode-label";

export function StorageModePicker({
  value,
  onChange,
  disabled = false,
}: StorageModePickerProps): React.ReactElement {
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  function handleKeyDown(currentIndex: number, e: React.KeyboardEvent<HTMLDivElement>): void {
    if (disabled) return;

    let nextIndex: number | null = null;

    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        nextIndex = (currentIndex + 1) % OPTIONS.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        nextIndex = (currentIndex - 1 + OPTIONS.length) % OPTIONS.length;
        break;
      case "Home":
        e.preventDefault();
        nextIndex = 0;
        break;
      case "End":
        e.preventDefault();
        nextIndex = OPTIONS.length - 1;
        break;
      case " ":
      case "Enter": {
        e.preventDefault();
        const current = OPTIONS[currentIndex];
        if (current) onChange(current.value);
        return;
      }
      default:
        return;
    }

    if (nextIndex !== null) {
      const next = OPTIONS[nextIndex];
      if (!next) return;
      onChange(next.value);
      itemRefs.current[nextIndex]?.focus();
    }
  }

  return (
    <div className="space-y-2">
      <p id={LABEL_ID} className="text-sm font-medium leading-none">
        Storage mode <span className="text-red-500">*</span>
      </p>
      <div role="radiogroup" aria-labelledby={LABEL_ID} aria-disabled={disabled || undefined}>
        <div className="space-y-2">
          {OPTIONS.map((option, index) => {
            const isSelected = value === option.value;
            return (
              // biome-ignore lint/a11y/useSemanticElements: custom-styled radio card; native <input type="radio"> would break the visual pattern. ARIA 1.2 radio semantics are satisfied via role + aria-checked + roving tabIndex and tested in storage-mode-picker.test.tsx.
              <div
                key={option.value}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                aria-disabled={disabled || undefined}
                className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-foreground bg-foreground/[0.02]"
                    : "border-border hover:border-foreground/30"
                } ${disabled ? "pointer-events-none opacity-50" : ""}`}
                onClick={() => {
                  if (!disabled) onChange(option.value);
                }}
                onKeyDown={(e) => handleKeyDown(index, e)}
              >
                <div
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isSelected ? "border-foreground" : "border-muted-foreground/40"
                  }`}
                >
                  {isSelected && <div className="h-2 w-2 rounded-full bg-foreground" />}
                </div>
                <div className="space-y-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

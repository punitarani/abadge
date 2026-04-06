"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps): React.ReactElement {
  return (
    <Sonner
      theme="light"
      richColors
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "border border-border bg-background text-foreground shadow-lg",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
}

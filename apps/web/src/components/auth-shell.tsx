import Link from "next/link";
import type { ReactNode } from "react";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 sm:px-8">
        <header className="flex h-20 items-center">
          <div className="flex w-full items-center gap-4">
            <Link href="/" className="inline-flex items-center gap-1.5">
              <img src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
              <span className="text-xl font-bold tracking-[-0.04em] text-foreground">abadge</span>
            </Link>
            <div className="hidden h-px flex-1 bg-border/80 sm:block" />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center py-12 sm:py-16">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}

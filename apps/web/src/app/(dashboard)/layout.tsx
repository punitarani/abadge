"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const navSections = [
  {
    label: "Vault",
    items: [
      { href: "/credentials", label: "Credentials" },
      { href: "/agents", label: "Agents" },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "/policies", label: "Policies" },
      { href: "/approvals", label: "Approvals" },
    ],
  },
  {
    label: "Observability",
    items: [{ href: "/audit", label: "Audit log" }],
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  const checkSession = useCallback(async () => {
    const session = await authClient.getSession();
    if (!session) {
      router.push("/login");
    } else {
      setAuthenticated(true);
    }
  }, [router]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="px-4 h-14 flex items-center border-b border-border">
          <Link href="/credentials" className="text-sm font-semibold tracking-tight">
            abadge
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navSections.map((section, i) => (
            <div key={section.label}>
              <div
                className={cn(
                  "px-2 pb-2 text-xs font-semibold text-muted-foreground",
                  i === 0 ? "pt-1" : "pt-4",
                )}
              >
                {section.label}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    pathname.startsWith(item.href)
                      ? "bg-neutral-100 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-neutral-50 hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-border px-2 py-3">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-neutral-50 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="h-14 border-b border-border" />
        <div className="px-8 py-6">{children}</div>
      </main>
    </div>
  );
}

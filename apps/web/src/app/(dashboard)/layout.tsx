"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { VaultProvider } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

/**
 * Legacy dashboard layout. Redirects to org-scoped routes or onboarding.
 * Kept so that old routes like /items still work temporarily.
 * Renders the dashboard shell while determining the redirect target,
 * then navigates once hydration and auth are settled.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const activeOrgSlug = useOrgStore((s) => s.activeOrgSlug);
  const [hydrated, setHydrated] = useState(false);

  // Wait for Zustand persist rehydration from localStorage
  useEffect(() => {
    // If already rehydrated (synchronous), set immediately
    if (useOrgStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useOrgStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return unsub;
  }, []);

  // Redirect once we know auth + org state
  useEffect(() => {
    if (sessionPending || !hydrated) return;

    if (!session) {
      router.push("/login");
      return;
    }

    if (activeOrgSlug) {
      router.push(`/${activeOrgSlug}/overview`);
    } else {
      router.push("/onboarding");
    }
  }, [sessionPending, session, hydrated, activeOrgSlug, router]);

  // Show the dashboard shell while determining redirect so users don't see a flash
  if (sessionPending || !hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // If authenticated but redirect hasn't happened yet, render the shell with children
  // This prevents a blank page flash during navigation
  if (session) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <div className="px-8 py-6">
            <VaultProvider>{children}</VaultProvider>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-sm text-muted-foreground">Redirecting...</div>
    </div>
  );
}

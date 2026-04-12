"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useOrgStore } from "@/stores/org-store";

/**
 * Legacy dashboard layout. Redirects to org-scoped routes or onboarding.
 * Kept so that old routes like /items still work temporarily.
 * Always shows a spinner — never renders the sidebar (which requires
 * an [org] URL segment that doesn't exist under (dashboard) routes).
 */
export default function DashboardLayout({
  children: _children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const activeOrgSlug = useOrgStore((s) => s.activeOrgSlug);
  const [hydrated, setHydrated] = useState(false);

  // Wait for Zustand persist rehydration from localStorage
  useEffect(() => {
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

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading...</div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useOrgStore } from "@/stores/org-store";

/**
 * Silently redirects authenticated users away from the landing page.
 * Renders nothing — the landing page content is still server-rendered
 * and visible until the redirect fires.
 */
export function AuthRedirect(): null {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const activeOrgSlug = useOrgStore((s) => s.activeOrgSlug);
  const [hydrated, setHydrated] = useState(false);

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

  useEffect(() => {
    if (isPending || !hydrated) return;
    if (!session) return;

    if (activeOrgSlug) {
      router.replace(`/${activeOrgSlug}/overview`);
    } else {
      router.replace("/onboarding");
    }
  }, [isPending, session, hydrated, activeOrgSlug, router]);

  return null;
}

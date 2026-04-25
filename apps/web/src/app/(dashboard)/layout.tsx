"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { VaultProvider } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

// biome-ignore lint/style/noRestrictedGlobals: Next.js replaces NEXT_PUBLIC_ at build time
const USERJOT_PROJECT_ID = process.env.NEXT_PUBLIC_USERJOT_PROJECT_ID;

declare global {
  interface Window {
    uj: {
      init: (projectId: string, options: Record<string, unknown>) => void;
      identify: (user: Record<string, string | undefined>) => void;
    };
    $ujq: unknown[];
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // Store selectors (not destructuring) so the layout only re-renders when
  // these specific fields change, not on every unrelated store update.
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const clearActiveOrg = useOrgStore((s) => s.clearActiveOrg);
  const [hydrated, setHydrated] = useState(false);
  const userId = session?.user?.id ?? null;

  // Wait for Zustand persist rehydration
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

  // Session-user-change guard: if the persisted org belongs to a different
  // user (e.g., prior signOut that didn't clear, cross-user browser reuse),
  // scrub it before any org-scoped tRPC call fires with a stale
  // X-Abadge-Org-Id header. Runs synchronously once hydrated + session known.
  //
  // We treat a null storedUserId as a mismatch so that browsers which
  // persisted state under the pre-lastUserId store shape also get scrubbed
  // on first load after this code ships. The org-resolution effect below
  // re-seeds the store from the server-truth org list, so the cost of a
  // spurious clear on a genuinely-fresh store is one re-fetch.
  useEffect(() => {
    if (!hydrated || sessionPending || !userId) return;
    const storedUserId = useOrgStore.getState().lastUserId;
    if (storedUserId !== userId) {
      clearActiveOrg();
    }
  }, [hydrated, sessionPending, userId, clearActiveOrg]);

  const orgsQuery = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
    enabled: !!session,
  });

  const orgs = orgsQuery.data?.organizations ?? [];

  // Resolve active org: validate stored org, fall back to first, or redirect to onboarding.
  // Gate on `orgsQuery.status === "success"` rather than `!orgsData`: a failed query leaves
  // data undefined AND isLoading false — the old `!orgsData` gate caused the layout to hang
  // on "Loading..." forever in that case instead of surfacing an error branch.
  useEffect(() => {
    if (!hydrated || sessionPending) return;

    if (!session || !userId) {
      router.push("/login");
      return;
    }

    if (orgsQuery.status !== "success") return;

    if (orgs.length === 0) {
      router.push("/onboarding");
      return;
    }

    const storedOrgValid = activeOrgId && orgs.some((o: { id: string }) => o.id === activeOrgId);
    if (!storedOrgValid) {
      // Stored org is stale or missing — fall back to first org (orgs.length > 0 checked above)
      const first = orgs[0];
      if (first) {
        setActiveOrg(userId, {
          id: first.id,
          slug: first.slug,
          name: first.name,
          logo: first.logo ?? null,
        });
      }
    }
  }, [
    hydrated,
    sessionPending,
    session,
    userId,
    orgsQuery.status,
    orgs,
    activeOrgId,
    setActiveOrg,
    router,
  ]);

  // UserJot analytics identify
  useEffect(() => {
    if (
      USERJOT_PROJECT_ID &&
      session?.user &&
      typeof window !== "undefined" &&
      window.uj?.identify
    ) {
      window.uj.identify({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
    }
  }, [session?.user]);

  // Surface `organizations.list` failures explicitly so the layout can never
  // hang on "Loading..." forever. The previous implementation conflated
  // "pending", "errored", and "not-yet-started" into a single loader.
  if (hydrated && !sessionPending && session && orgsQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">We couldn't load your organizations</h1>
          <p className="text-sm text-muted-foreground">
            {getClientErrorMessage(
              orgsQuery.error,
              "The server didn't respond. Check your connection and try again.",
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => void orgsQuery.refetch()}>Retry</Button>
            <Button
              variant="outline"
              onClick={async () => {
                await authClient.signOut();
                router.push("/login");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show loading while auth, orgs, or store hydration are pending
  const orgReady =
    hydrated && activeOrgId && orgs.some((o: { id: string }) => o.id === activeOrgId);
  if (sessionPending || !session || orgsQuery.isPending || !orgReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <VaultProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <div className="px-8 py-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </VaultProvider>
      {USERJOT_PROJECT_ID && (
        <>
          <Script id="userjot-loader" strategy="afterInteractive">
            {`window.$ujq=window.$ujq||[];window.uj=window.uj||new Proxy({},{get:(_,p)=>(...a)=>window.$ujq.push([p,...a])});document.head.appendChild(Object.assign(document.createElement('script'),{src:'https://cdn.userjot.com/sdk/v2/uj.js',type:'module',async:!0}));`}
          </Script>
          <Script id="userjot-init" strategy="afterInteractive">
            {`window.uj.init('${USERJOT_PROJECT_ID}',{widget:true,position:'right',theme:'auto'});`}
          </Script>
        </>
      )}
    </>
  );
}

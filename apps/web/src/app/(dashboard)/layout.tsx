"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
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
  const { activeOrgId, setActiveOrg } = useOrgStore();
  const [hydrated, setHydrated] = useState(false);

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

  const { data: orgsData, isLoading: orgsLoading } = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
    enabled: !!session,
  });

  const orgs = orgsData?.organizations ?? [];

  // Resolve active org: validate stored org, fall back to first, or redirect to onboarding
  useEffect(() => {
    if (!hydrated || sessionPending || orgsLoading || !orgsData) return;

    if (!session) {
      router.push("/login");
      return;
    }

    if (orgs.length === 0) {
      router.push("/onboarding");
      return;
    }

    const storedOrgValid = activeOrgId && orgs.some((o: { id: string }) => o.id === activeOrgId);
    if (!storedOrgValid) {
      // Stored org is stale or missing — fall back to first org (orgs.length > 0 checked above)
      const first = orgs[0];
      if (first) {
        setActiveOrg({ id: first.id, slug: first.slug, name: first.name });
      }
    }
  }, [
    hydrated,
    sessionPending,
    session,
    orgsLoading,
    orgsData,
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

  // Show loading while auth, orgs, or store hydration are pending
  const orgReady = hydrated && activeOrgId && orgs.some((o: { id: string }) => o.id === activeOrgId);
  if (sessionPending || !session || orgsLoading || !orgReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <div className="px-8 py-6">
            <VaultProvider>{children}</VaultProvider>
          </div>
        </SidebarInset>
      </SidebarProvider>
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

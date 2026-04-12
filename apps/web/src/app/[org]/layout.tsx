"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";
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

export default function OrgLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  const router = useRouter();
  const params = useParams<{ org: string }>();
  const orgSlug = params.org;

  const { data: session, isPending: sessionPending } = authClient.useSession();
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  const { data: orgsData, isLoading: orgsLoading } = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
    enabled: !!session,
  });

  const orgs = orgsData?.organizations ?? [];
  const matchedOrg = orgs.find((o: { slug: string }) => o.slug === orgSlug);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!sessionPending && !session) {
      router.push("/login");
    }
  }, [sessionPending, session, router]);

  // Redirect to onboarding if org slug not found in user's orgs
  useEffect(() => {
    if (!orgsLoading && orgsData && !matchedOrg) {
      router.push("/onboarding");
    }
  }, [orgsLoading, orgsData, matchedOrg, router]);

  // Sync matched org to Zustand store
  const matchedOrgId = matchedOrg?.id as string | undefined;
  const matchedOrgSlug = matchedOrg?.slug as string | undefined;
  const matchedOrgName = matchedOrg?.name as string | undefined;
  useEffect(() => {
    if (matchedOrgId && matchedOrgSlug && matchedOrgName) {
      setActiveOrg({ id: matchedOrgId, slug: matchedOrgSlug, name: matchedOrgName });
    }
  }, [matchedOrgId, matchedOrgSlug, matchedOrgName, setActiveOrg]);

  // UserJot analytics identify
  useEffect(() => {
    if (USERJOT_PROJECT_ID && session?.user) {
      window.uj.identify({
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      });
    }
  }, [session?.user]);

  // Show loading while auth or orgs are loading
  if (sessionPending || !session || orgsLoading || !matchedOrg) {
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

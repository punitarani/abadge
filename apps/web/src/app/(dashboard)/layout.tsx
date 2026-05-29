"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardLoading } from "@/components/dashboard/dashboard-loading";
import { MobileHeader } from "@/components/dashboard/mobile-header";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useVault, VaultProvider } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";
import { decideLayoutAction, type OrgSummary } from "./layout-triage";

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

/**
 * Persistent dashboard shell. The sidebar, vault provider, and chrome render
 * UNCONDITIONALLY here so they survive every transient state hiccup that the
 * gate inside `<SidebarInset>` recovers from. Auth/org gating lives in
 * {@link DashboardGate}, which renders inside the content area only — that
 * way a momentary "loading" or "redirect" state never blanks out the
 * sidebar/header chrome.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <VaultProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <MobileHeader />
            <div className="px-4 py-6 sm:px-6 md:px-8">
              <DashboardGate>{children}</DashboardGate>
            </div>
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

/**
 * Auth/org gate for the dashboard. Renders one of:
 *   - children — when the session and active org are ready
 *   - inline error card — when `organizations.list` fails
 *   - inline loader — while session, org list, or Zustand are pending
 *
 * Lives INSIDE `<SidebarInset>` so the sidebar/header chrome stay visible
 * during gating and the user never sees a full blank-screen flash. The
 * redirect-to-login and redirect-to-onboarding behavior is driven by a single
 * `useEffect` calling `decideLayoutAction()` — a pure function extracted to
 * `./layout-triage` and unit-tested in `layout-triage.test.ts`.
 */
function DashboardGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { lockAll } = useVault();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // Store selectors (not destructuring) so the gate only re-renders when
  // these specific fields change, not on every unrelated store update.
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const clearActiveOrg = useOrgStore((s) => s.clearActiveOrg);
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

  const orgsQuery = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: () => browserTrpcClient.organizations.list.query(),
    enabled: !!session,
  });

  const orgs = (orgsQuery.data?.organizations ?? []) as OrgSummary[];

  // Delegate routing to decideLayoutAction so the effect body stays linear.
  // Gate on `orgsQuery.status === "success"` rather than `!orgsData`: a
  // failed query leaves data undefined AND isLoading false — the old
  // `!orgsData` gate caused the layout to hang on "Loading..." forever
  // instead of surfacing an error branch.
  useEffect(() => {
    const action = decideLayoutAction({
      hydrated,
      sessionPending,
      session,
      orgsStatus: orgsQuery.status,
      orgs,
      activeOrgId,
    });
    if (action.kind === "redirect") {
      router.push(action.to);
    } else if (action.kind === "adopt") {
      setActiveOrg({
        id: action.org.id,
        slug: action.org.slug,
        name: action.org.name,
        logo: action.org.logo ?? null,
      });
    }
  }, [
    hydrated,
    sessionPending,
    session,
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

  // Surface `organizations.list` failures explicitly so the gate can never
  // hang on "Loading..." forever. The previous implementation conflated
  // "pending", "errored", and "not-yet-started" into a single loader.
  if (hydrated && !sessionPending && session && orgsQuery.isError) {
    return (
      <div className="flex items-center justify-center py-12">
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
                // Full parity with nav-user.tsx's handleSignOut so the recovery
                // path leaves nothing behind for the next user on this browser:
                // lock in-memory vault secrets, then clear the persisted org
                // context + query cache before signing out. A stale org header
                // is what drives most "couldn't load organizations" states, so
                // it must not survive sign-out either.
                lockAll();
                clearActiveOrg();
                queryClient.clear();
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

  // Inline loader while auth, orgs, or store hydration are pending. orgReady
  // requires only that the stored active org is one the user actually belongs
  // to — it MUST NOT require a bootstrapped profile. Gating on
  // `hasBootstrappedProfile` here (combined with the effect's redirect) made a
  // profile-less org ping-pong between /overview and /onboarding forever, since
  // onboarding's `decideResumeAction` sends any org straight back to the
  // dashboard. A profile-less org renders the dashboard; the profiles page
  // surfaces the recovery flow. The loader lives INSIDE `<SidebarInset>` (the
  // parent layout renders the chrome unconditionally), so the sidebar stays
  // visible during this gate — no full blank-screen flash on transient hiccups.
  const orgReady = hydrated && activeOrgId && orgs.some((o) => o.id === activeOrgId);
  if (sessionPending || !session || orgsQuery.isPending || !orgReady) {
    return <DashboardLoading />;
  }

  return <>{children}</>;
}

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

interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  // Non-optional: server schema (`organizations.list` -> Schema.Boolean) always
  // populates this. Keeping it strict here means a future server-side regression
  // (e.g. accidentally omitting the field) trips the typecheck instead of
  // silently leaving `orgReady` permanently false and hanging the dashboard.
  hasBootstrappedProfile: boolean;
}

type LayoutDecision =
  | { kind: "wait" }
  | { kind: "redirect"; to: string }
  | { kind: "adopt"; org: OrgSummary }
  | { kind: "ready" };

/**
 * Pure decision function for dashboard layout routing, extracted to keep the
 * `useEffect` body linear and well under the cognitive-complexity limit.
 * Inputs are whatever state matters to the routing call; outputs are one of
 * four actions the effect applies.
 *
 * Rules (in order): wait for hydration/session, redirect unauthenticated to
 * login, wait for orgs query to succeed, redirect to /onboarding when the
 * user has no org or no fully set-up org, adopt the first usable org when
 * the stored one is stale, otherwise the layout is ready.
 */
function decideLayoutAction(args: {
  hydrated: boolean;
  sessionPending: boolean;
  session: unknown;
  orgsStatus: "pending" | "error" | "success";
  orgs: OrgSummary[];
  activeOrgId: string | null;
}): LayoutDecision {
  if (!args.hydrated || args.sessionPending) return { kind: "wait" };
  if (!args.session) return { kind: "redirect", to: "/login" };
  if (args.orgsStatus !== "success") return { kind: "wait" };
  if (args.orgs.length === 0) return { kind: "redirect", to: "/onboarding" };

  const usableOrgs = args.orgs.filter((o) => o.hasBootstrappedProfile);
  if (usableOrgs.length === 0) return { kind: "redirect", to: "/onboarding" };

  const storedValid = args.activeOrgId != null && usableOrgs.some((o) => o.id === args.activeOrgId);
  if (storedValid) return { kind: "ready" };

  const first = usableOrgs[0];
  if (!first) return { kind: "redirect", to: "/onboarding" };
  return { kind: "adopt", org: first };
}

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

  // Show loading while auth, orgs, or store hydration are pending. orgReady
  // requires the active org to also have a bootstrapped profile — otherwise
  // scoped child queries would fail with ONBOARDING_INCOMPLETE. The effect
  // above redirects to /onboarding; this render guard keeps the dashboard
  // from briefly flashing broken state in that window.
  const orgReady =
    hydrated && activeOrgId && orgs.some((o) => o.id === activeOrgId && o.hasBootstrappedProfile);
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

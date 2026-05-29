"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, TicketCheck, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreateOrgForm } from "@/components/onboarding/create-org-form";
import { InviteAcceptForm } from "@/components/onboarding/invite-accept-form";
import { authClient } from "@/lib/auth-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";
import { decideResumeAction } from "./onboarding-triage";

type OnboardingMode = "choose" | "create" | "join";

export default function OnboardingPage(): React.ReactElement | null {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // Stable primitive: Better Auth's useSession() can return a fresh object
  // reference per render. Depending on session.user.id keeps effects from
  // re-firing (and redoing organizations.list) on unrelated renders.
  const userId = session?.user?.id ?? null;

  // Mode selects which surface to render: a two-option choose screen for
  // fresh signups, the create-org form, or the invite-paste form.
  const [mode, setMode] = useState<OnboardingMode>("choose");

  // Tracks the resume-triage mount effect so we don't flash the form while
  // we decide whether the user should redirect to overview.
  const [isCheckingOrgs, setIsCheckingOrgs] = useState(true);

  // Personal account is a one-click action (no name/slug form): create the
  // hidden personal org, adopt it as active, and head to the dashboard.
  const queryClient = useQueryClient();
  const [creatingPersonal, setCreatingPersonal] = useState(false);
  const [personalError, setPersonalError] = useState("");

  async function handleCreatePersonal(): Promise<void> {
    setPersonalError("");
    setCreatingPersonal(true);
    try {
      const { organization: org } = await browserTrpcClient.organizations.createPersonal.mutate();
      useOrgStore
        .getState()
        .setActiveOrg({ id: org.id, slug: org.slug, name: org.name, logo: org.logo ?? null });
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });
      router.push("/overview");
    } catch (err) {
      setPersonalError(getClientErrorMessage(err, "Failed to create your personal account"));
      setCreatingPersonal(false);
    }
  }

  // Auth guard — unauthenticated visitors shouldn't see the create-org form.
  // Redirect happens in an effect to avoid side-effects during render.
  useEffect(() => {
    if (!sessionPending && !userId) {
      router.replace("/login?redirect=/onboarding");
    }
  }, [sessionPending, userId, router]);

  // Resume-triage: if the user already has any org, redirect to /overview.
  // PR3's auto-default profile makes every fresh org immediately usable;
  // an admin who deletes the default profile recovers from the profiles
  // page, not from this onboarding flow.
  useEffect(() => {
    if (sessionPending || !userId) return;

    let cancelled = false;
    (async () => {
      try {
        const listResult = await browserTrpcClient.organizations.list.query();
        if (cancelled) return;
        const action = decideResumeAction(listResult.organizations ?? []);
        if (action.kind === "redirect") {
          router.replace("/overview");
          return;
        }
        setIsCheckingOrgs(false);
      } catch (err) {
        // If the resume probe fails (network, auth race, etc.), fall
        // through to the choose screen. Users can still create a new org.
        console.warn("[onboarding] Failed to detect existing org state:", err);
        if (!cancelled) setIsCheckingOrgs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionPending, userId, router]);

  if (sessionPending || !session?.user || isCheckingOrgs) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 sm:px-8">
        {/* Header */}
        <header className="flex h-20 items-center">
          <Link href="/" className="inline-flex items-center gap-1.5">
            <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
            <span className="text-xl font-bold tracking-[-0.04em] text-foreground">abadge</span>
          </Link>
        </header>

        {/* Main — vertically centered like the auth screens. The choose screen
            needs room for three cards; the create/join forms read better narrow. */}
        <main className="flex flex-1 items-center justify-center py-12 sm:py-16">
          <div className={`w-full space-y-8 ${mode === "choose" ? "max-w-3xl" : "max-w-md"}`}>
            {/* Choose-mode landing: two large options for fresh signups. */}
            {mode === "choose" && (
              <div className="space-y-6">
                <div className="space-y-1 text-center">
                  <h1 className="text-2xl font-semibold tracking-tight">Welcome to abadge</h1>
                  <p className="text-sm text-muted-foreground">How do you want to get started?</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={handleCreatePersonal}
                    disabled={creatingPersonal}
                    className="group flex flex-col items-start gap-3 h-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-foreground/40 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:p-6"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-base font-semibold">
                        {creatingPersonal ? "Setting up…" : "Personal account"}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Just for you. One profile to store secrets right away — add agents and more
                        profiles later.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("create")}
                    disabled={creatingPersonal}
                    className="group flex flex-col items-start gap-3 h-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-foreground/40 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:p-6"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-base font-semibold">Create a new organization</div>
                      <p className="text-sm text-muted-foreground">
                        You'll be the owner. A default profile is created so you can store secrets
                        right away.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("join")}
                    disabled={creatingPersonal}
                    className="group flex flex-col items-start gap-3 h-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-foreground/40 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:p-6"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <TicketCheck className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-base font-semibold">Join with an invite</div>
                      <p className="text-sm text-muted-foreground">
                        Paste a link or code from your organization admin.
                      </p>
                    </div>
                  </button>
                </div>

                {personalError && (
                  <p className="text-center text-sm text-destructive">{personalError}</p>
                )}
              </div>
            )}

            {/* Join path: shared InviteAcceptForm. */}
            {mode === "join" && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setMode("choose")}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  ← Back
                </button>
                <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
                  <div className="mb-5 space-y-1">
                    <h1 className="text-xl font-semibold tracking-tight">Join an organization</h1>
                    <p className="text-sm text-muted-foreground">
                      Paste the invite link or code your admin shared with you.
                    </p>
                  </div>
                  <InviteAcceptForm variant="card" />
                </div>
              </div>
            )}

            {/* Create path: single-step CreateOrgForm. */}
            {mode === "create" && (
              <CreateOrgForm
                variant="card"
                onBack={() => setMode("choose")}
                onSuccess={() => {
                  router.push("/overview");
                }}
              />
            )}

            {/* Footer links — TOS moved to /register. This page is post-signup. */}
            {mode === "choose" && (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link href="/login" className="font-medium text-foreground hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

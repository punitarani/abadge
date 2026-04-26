"use client";

import { Building2, TicketCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreateOrgForm } from "@/components/onboarding/create-org-form";
import { InviteAcceptForm } from "@/components/onboarding/invite-accept-form";
import { authClient } from "@/lib/auth-client";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";
import { decideResumeAction } from "./onboarding-triage";

type OnboardingMode = "choose" | "create" | "join";

interface ResumeState {
  orgId: string;
  orgName: string;
  orgSlug: string;
  step: 0 | 1;
}

export default function OnboardingPage(): React.ReactElement | null {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // Stable primitive: Better Auth's useSession() can return a fresh object
  // reference per render. Depending on session.user.id keeps effects from
  // re-firing (and redoing organizations.list) on unrelated renders.
  const userId = session?.user?.id ?? null;
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  // Mode selects which surface to render: a two-option choose screen for
  // fresh signups, the existing create-org flow, or the invite-paste form.
  const [mode, setMode] = useState<OnboardingMode>("choose");

  // Tracks the resume-triage mount effect so we don't flash step 1 while we
  // decide whether the user should resume step 2 or redirect to overview.
  const [isCheckingOrgs, setIsCheckingOrgs] = useState(true);

  // Seed for CreateOrgForm when resuming a partial onboarding (org row exists
  // but profile wasn't bootstrapped). null means "fresh create".
  const [resumeState, setResumeState] = useState<ResumeState | null>(null);

  // Auth guard — unauthenticated visitors shouldn't see the create-org form.
  // Redirect happens in an effect to avoid side-effects during render.
  useEffect(() => {
    if (!sessionPending && !userId) {
      router.replace("/login?redirect=/onboarding");
    }
  }, [sessionPending, userId, router]);

  // Resume-triage: if the user abandoned onboarding (tab close after org
  // create but before profile bootstrap), skip straight to step 2 for that
  // org. If they are fully onboarded, redirect to /overview. If they have no
  // orgs, fall through to the choose screen.
  useEffect(() => {
    if (sessionPending || !userId) return;

    let cancelled = false;
    const applyResume = (action: ReturnType<typeof decideResumeAction>): void => {
      if (action.kind === "redirect") {
        router.replace("/overview");
        return;
      }
      if (action.kind === "resume-profile") {
        const { org } = action;
        setActiveOrg({ id: org.id, slug: org.slug, name: org.name, logo: org.logo });
        setResumeState({
          orgId: org.id,
          orgName: org.name,
          orgSlug: org.slug,
          step: 1,
        });
        // An org already exists for this user (they abandoned after step 1).
        // Skip the choose screen and resume on the profile-setup step.
        setMode("create");
      }
      setIsCheckingOrgs(false);
    };
    (async () => {
      try {
        const listResult = await browserTrpcClient.organizations.list.query();
        if (cancelled) return;
        applyResume(decideResumeAction(listResult.organizations ?? []));
      } catch (err) {
        // If the resume probe fails (network, auth race, etc.), fall through
        // to the choose screen. Users can still create a new org.
        console.warn("[onboarding] Failed to detect existing org state:", err);
        if (!cancelled) setIsCheckingOrgs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionPending, userId, router, setActiveOrg]);

  if (sessionPending || !session?.user || isCheckingOrgs) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 sm:px-8">
        {/* Header */}
        <header className="flex h-20 items-center">
          <Link href="/" className="inline-flex items-center gap-1.5">
            <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
            <span className="text-xl font-bold tracking-[-0.04em] text-foreground">abadge</span>
          </Link>
        </header>

        {/* Main */}
        <main className="flex flex-1 flex-col items-center py-12 sm:py-16">
          <div className="w-full max-w-lg space-y-8">
            {/* Choose-mode landing: two large options for fresh signups. */}
            {mode === "choose" && (
              <div className="space-y-6">
                <div className="space-y-1 text-center">
                  <h1 className="text-2xl font-semibold tracking-tight">Welcome to abadge</h1>
                  <p className="text-sm text-muted-foreground">How do you want to get started?</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("create");
                      setResumeState(null);
                    }}
                    className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-colors hover:border-foreground/40 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-base font-semibold">Create a new organization</div>
                      <p className="text-sm text-muted-foreground">
                        You'll be the owner. Set up profiles, items, and agents.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode("join")}
                    className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6 text-left shadow-sm transition-colors hover:border-foreground/40 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
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

            {/* Create path: shared CreateOrgForm. */}
            {mode === "create" && (
              <CreateOrgForm
                variant="card"
                initialOrg={resumeState ?? undefined}
                onBack={() => {
                  setMode("choose");
                  setResumeState(null);
                }}
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

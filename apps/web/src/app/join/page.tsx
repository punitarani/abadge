"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { InviteAcceptForm } from "@/components/onboarding/invite-accept-form";
import { authClient } from "@/lib/auth-client";

/**
 * Shareable/pasteable alternative to `/invite/accept?token=…`.
 *
 * The existing /invite/accept route continues to serve email invite links
 * as-is. /join is the URL we point users at when they want to *manually*
 * paste a token — the form accepts a raw code or a full URL so the same
 * affordance works whether admins send "abi_xyz" or "https://.../join?token=".
 */
function JoinPageContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  // Capture `?token=` once, then strip it from the URL so it doesn't leak via
  // Referer on outbound loads. Same pattern as /invite/accept.
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) {
    tokenRef.current = searchParams.get("token") ?? "";
  }
  const initialToken = tokenRef.current;

  useEffect(() => {
    if (session && searchParams.get("token")) {
      router.replace("/join", { scroll: false });
    }
  }, [session, searchParams, router]);

  // Gate behind authentication so the server rejects lookups from strangers
  // and the rate-limit counter keys on a real userId.
  if (!sessionPending && !session) {
    const returnPath = initialToken ? `/join?token=${encodeURIComponent(initialToken)}` : "/join";
    router.replace(`/login?redirect=${encodeURIComponent(returnPath)}`);
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  if (sessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 sm:px-8">
        <header className="flex h-20 items-center">
          <Link href="/" className="inline-flex items-center gap-1.5">
            <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
            <span className="text-xl font-bold tracking-[-0.04em] text-foreground">abadge</span>
          </Link>
        </header>

        <main className="flex flex-1 flex-col items-center py-12 sm:py-16">
          <div className="w-full max-w-lg space-y-6">
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <div className="mb-5 space-y-1">
                <h1 className="text-xl font-semibold tracking-tight">Join an organization</h1>
                <p className="text-sm text-muted-foreground">
                  Paste the invite link or code your admin shared with you.
                </p>
              </div>
              <InviteAcceptForm variant="card" initialToken={initialToken || undefined} />
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Don't have an invite?{" "}
                <Link href="/onboarding" className="font-medium text-foreground hover:underline">
                  Create an organization instead
                </Link>
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function JoinPageFallback(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

export default function JoinPage(): React.ReactElement {
  return (
    <Suspense fallback={<JoinPageFallback />}>
      <JoinPageContent />
    </Suspense>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { InviteAcceptForm } from "@/components/onboarding/invite-accept-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

/**
 * Email-invite landing page. Renders the shared InviteAcceptForm so this
 * route, /join, /onboarding (join card), and the dashboard org-switcher
 * dialog all share one form implementation. The page wrapper handles
 * auth gating, token capture, and post-auth URL hygiene; the form handles
 * lookup, preview, accept, and post-success navigation.
 */
function AcceptInviteContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  // Capture the token from the URL exactly once, then strip it from the URL
  // below so it doesn't leak via Referer to any later outbound loads or sit
  // in browser history. Subsequent renders read the token from this ref.
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) {
    tokenRef.current = searchParams.get("token") ?? "";
  }
  const token = tokenRef.current;
  const authed = !sessionPending && !!session;

  // Strip ?token=... from the URL once auth has resolved. We keep the token
  // in tokenRef so this component can still use it, but window.location no
  // longer carries it -- so subsequent outbound loads and history entries
  // cannot leak it via Referer. We only strip after auth is resolved;
  // otherwise we still need the token in the URL to forward it through
  // /login -> /register -> back here.
  useEffect(() => {
    if (authed && searchParams.get("token")) {
      router.replace("/invite/accept", { scroll: false });
    }
  }, [authed, searchParams, router]);

  // Redirect to login if not authenticated, preserving the invite token.
  // The token in the redirect URL is unavoidable for the cross-page handoff,
  // but /invite/:path*, /login, and /register are served with
  // Referrer-Policy: no-referrer (see apps/web/next.config.ts) so outbound
  // loads from those pages do not leak the token via the Referer header.
  // Run the redirect inside an effect so we don't mutate router state during
  // render (React anti-pattern; the previous inline call worked but emitted
  // dev-mode warnings and a transient extra render).
  useEffect(() => {
    if (sessionPending || session) return;
    const returnPath = `/invite/accept?token=${encodeURIComponent(token)}`;
    router.replace(`/login?redirect=${encodeURIComponent(returnPath)}`);
  }, [sessionPending, session, token, router]);

  if (sessionPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {sessionPending ? "Loading..." : "Redirecting to sign in..."}
        </p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="p-6 max-w-sm text-center space-y-2">
          <h1 className="text-lg font-semibold">Invalid invite link</h1>
          <p className="text-sm text-muted-foreground">
            This link is missing the invite token. Ask the organization admin for a new link.
          </p>
          <Button variant="outline" size="sm" onClick={() => router.push("/overview")}>
            Go to dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="p-6 w-full max-w-md">
        <InviteAcceptForm initialToken={token} variant="card" />
      </Card>
    </div>
  );
}

function AcceptInviteFallback(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  );
}

export default function AcceptInvitePage(): React.ReactElement {
  return (
    <Suspense fallback={<AcceptInviteFallback />}>
      <AcceptInviteContent />
    </Suspense>
  );
}

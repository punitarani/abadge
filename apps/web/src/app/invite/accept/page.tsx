"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

function AcceptInviteContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Capture the token from the URL exactly once, then strip it from the URL
  // below so it doesn't leak via Referer to any later outbound loads or sit
  // in browser history. Subsequent renders read the token from this ref.
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) {
    tokenRef.current = searchParams.get("token") ?? "";
  }
  const token = tokenRef.current;
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const authed = !sessionPending && !!session;

  // Strip ?token=... from the URL after the first render once we know the
  // user is authenticated. We keep the token in tokenRef so this component
  // can still use it, but window.location no longer carries it -- so
  // subsequent outbound loads and history entries cannot leak it via Referer.
  // We only strip after auth is resolved; otherwise we still need the token
  // in the URL to forward it through /login -> /register -> back here.
  useEffect(() => {
    if (authed && searchParams.get("token")) {
      router.replace("/invite/accept", { scroll: false });
    }
  }, [authed, searchParams, router]);

  // Redirect to login if not authenticated, preserving the invite token.
  // The token in the redirect URL is unavoidable for the cross-page handoff,
  // but /login and /register are served with Referrer-Policy: no-referrer
  // (see apps/web/next.config.ts) so outbound loads from those pages do not
  // leak the token via the Referer header.
  if (!sessionPending && !session) {
    const returnPath = `/invite/accept?token=${encodeURIComponent(token)}`;
    router.replace(`/login?redirect=${encodeURIComponent(returnPath)}`);
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Redirecting to sign in...</p>
      </div>
    );
  }

  if (sessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
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
          <Button variant="outline" size="sm" onClick={() => router.push("/items")}>
            Go to dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return <InviteDetails token={token} />;
}

function InviteDetails({ token }: { token: string }): React.ReactElement {
  const router = useRouter();
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  const infoQuery = useQuery({
    queryKey: ["invite-info", token],
    queryFn: () => browserTrpcClient.organizations.members.getInviteInfo.query({ token }),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => browserTrpcClient.organizations.members.acceptInvite.mutate({ token }),
    onSuccess: (data) => {
      // Switch to the newly joined org so the dashboard shows it immediately
      setActiveOrg({
        id: data.organizationId,
        slug: data.organizationSlug,
        name: data.organizationName,
        logo: null,
      });
      toast.success("You've joined the organization!");
      router.push("/items");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to accept invitation"));
    },
  });

  if (infoQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading invite details...</p>
      </div>
    );
  }

  if (infoQuery.error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="p-6 max-w-sm text-center space-y-2">
          <h1 className="text-lg font-semibold">Invite not available</h1>
          <p className="text-sm text-muted-foreground">
            {getClientErrorMessage(infoQuery.error, "This invite link is invalid or has expired.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => router.push("/items")}>
            Go to dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const info = infoQuery.data;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="p-6 max-w-sm space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Join {info.organizationName}</h1>
          <p className="text-sm text-muted-foreground">
            You've been invited to join as a <strong>{info.role}</strong>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => acceptMutation.mutate()}
            disabled={acceptMutation.isPending}
          >
            {acceptMutation.isPending ? "Joining..." : "Accept invite"}
          </Button>
          <Button variant="outline" onClick={() => router.push("/items")}>
            Decline
          </Button>
        </div>
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

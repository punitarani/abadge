"use client";

import { useQuery } from "@tanstack/react-query";
import { Info, Monitor } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AuthShell } from "@/components";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

function normalizeUserCode(value: string | null): string {
  return (value ?? "").trim().replace(/-/g, "").toUpperCase();
}

/** Format code for display: "ABCD1234" → "A B C D - 1 2 3 4" */
function formatCodeForDisplay(code: string): string {
  if (code.length === 0) return "";
  const mid = Math.ceil(code.length / 2);
  const left = code.slice(0, mid).split("").join(" ");
  const right = code.slice(mid).split("").join(" ");
  return `${left} - ${right}`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getDecisionErrorMessage(
  decision: "approve" | "deny",
  response: { error?: { message?: string | null } | null } | undefined,
): string {
  return (
    response?.error?.message ??
    (decision === "approve"
      ? "Could not approve this device request."
      : "Could not deny this device request.")
  );
}

/** Default TTL for device codes (15 minutes). Better Auth does not expose expiry via URL params. */
const DEVICE_CODE_TTL_SECONDS = 900;

function useCountdown(ttlSeconds: number): number {
  const [remaining, setRemaining] = useState(ttlSeconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  return remaining;
}

function getApprovalRedirect(orgSlug: string | null): string {
  return orgSlug ? "/overview" : "/onboarding";
}

function DeviceApprovalPageContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const activeOrgSlug = useOrgStore((s) => s.activeOrgSlug);
  const userCode = useMemo(
    () => normalizeUserCode(searchParams.get("user_code") ?? searchParams.get("userCode")),
    [searchParams],
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const remaining = useCountdown(DEVICE_CODE_TTL_SECONDS);
  const expired = remaining <= 0;

  // Gate CLI approval on the *user's* onboarding status, not the active org:
  // if the user hasn't finished onboarding they can't hand the CLI a usable
  // session. The server-side tRPC gate already rejects, but checking here
  // first gives a clear pre-approval error instead of the CLI looking
  // logged-in and then failing on its first call.
  //
  // Fail-open on query error: server-side gates (scopedSessionProcedure +
  // agentProcedure + exchangeAgentSession) are the source of truth. If the
  // status fetch fails (network/auth/500) we let the user reach the
  // Approve/Deny buttons rather than trapping them on "Checking your
  // account…" until the 15-minute device code silently expires. An
  // under-onboarded user who slips through here will still hit a clear
  // ONBOARDING_INCOMPLETE error from the server on their first tRPC call.
  const onboardingQuery = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: () => browserTrpcClient.onboarding.status.query(),
    enabled: !!session,
  });
  const onboardingComplete = onboardingQuery.isError
    ? true
    : (onboardingQuery.data?.complete ?? null);

  useEffect(() => {
    if (!userCode || isPending) return;
    if (!session) {
      router.replace(
        `/login?redirect=${encodeURIComponent(`/device/approve?user_code=${userCode}`)}`,
      );
    }
  }, [isPending, router, session, userCode]);

  const handleDecision = useCallback(
    async (decision: "approve" | "deny"): Promise<void> => {
      if (!userCode) {
        setError("Missing device code.");
        return;
      }

      setError("");
      setSubmitting(decision);

      try {
        const response =
          decision === "approve"
            ? await authClient.device.approve({ userCode })
            : await authClient.device.deny({ userCode });

        if (response?.error) {
          setError(getDecisionErrorMessage(decision, response));
          return;
        }

        const next = decision === "approve" ? getApprovalRedirect(activeOrgSlug) : "/device";
        router.replace(next);
      } catch {
        setError(
          decision === "approve"
            ? "Could not approve this device request."
            : "Could not deny this device request.",
        );
      } finally {
        setSubmitting(null);
      }
    },
    [router, userCode, activeOrgSlug],
  );

  if (!userCode) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Monitor className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Approve device sign-in</h1>
          <p className="text-sm text-muted-foreground">A valid device code is required.</p>
          <Button onClick={() => router.push("/device")} className="w-full">
            Enter code
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (isPending || !session) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Monitor className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Approve device sign-in</h1>
          <p className="text-sm text-muted-foreground">Checking your session...</p>
        </div>
      </AuthShell>
    );
  }

  // User signed in but onboarding-status not yet fetched → wait a beat so
  // the approval button doesn't flash as enabled for incomplete accounts.
  if (onboardingComplete === null) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Monitor className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Approve device sign-in</h1>
          <p className="text-sm text-muted-foreground">Checking your account…</p>
        </div>
      </AuthShell>
    );
  }

  // Block approval for users who haven't finished onboarding. Server-side
  // gates still enforce this (scopedSessionProcedure + agentProcedure), but
  // catching it here avoids the CLI briefly appearing logged-in before
  // erroring on its first call.
  if (!onboardingComplete) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <Monitor className="h-6 w-6 text-amber-700" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Finish onboarding first</h1>
          <p className="text-sm text-muted-foreground">
            Before you can approve a CLI or MCP device, you need at least one organization with a
            set-up profile. Create or join an organization and bootstrap a profile, then come back
            to approve the device.
          </p>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full">
              <Link href="/onboarding">Go to onboarding</Link>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void handleDecision("deny")}
              disabled={submitting !== null}
            >
              {submitting === "deny" ? "Denying…" : "Deny this request"}
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="flex flex-col items-center space-y-1 text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Monitor className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Approve device sign-in</h1>
          <p className="text-sm text-muted-foreground">
            A device is requesting access to your account.
            <br />
            Enter the code shown in your terminal.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-lg border border-border px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Device code
          </div>
          <div className="mt-2 text-center font-mono text-2xl tracking-widest">
            {formatCodeForDisplay(userCode)}
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            {expired ? "Expired" : `Expires in ${formatCountdown(remaining)}`}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Only approve this request if you initiated it from your terminal by running{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">abadge login</code>.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void handleDecision("deny")}
            disabled={submitting !== null}
          >
            {submitting === "deny" ? "Denying..." : "Deny"}
          </Button>
          <Button
            type="button"
            className="w-full"
            onClick={() => void handleDecision("approve")}
            disabled={submitting !== null || expired}
          >
            {submitting === "approve" ? "Approving..." : "Approve"}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}

function DeviceApprovalFallback(): React.ReactElement {
  return (
    <AuthShell>
      <div className="flex flex-col items-center space-y-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Monitor className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Approve device sign-in</h1>
        <p className="text-sm text-muted-foreground">Loading device authorization...</p>
      </div>
    </AuthShell>
  );
}

export default function DeviceApprovalPage(): React.ReactElement {
  return (
    <Suspense fallback={<DeviceApprovalFallback />}>
      <DeviceApprovalPageContent />
    </Suspense>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AuthShell } from "@/components";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

function normalizeUserCode(value: string | null): string {
  return (value ?? "").trim().replace(/-/g, "").toUpperCase();
}

function DeviceApprovalPageContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const userCode = useMemo(
    () => normalizeUserCode(searchParams.get("user_code") ?? searchParams.get("userCode")),
    [searchParams],
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    if (!userCode || isPending) {
      return;
    }

    if (!session) {
      router.replace(
        `/login?redirect=${encodeURIComponent(`/device/approve?user_code=${userCode}`)}`,
      );
    }
  }, [isPending, router, session, userCode]);

  async function handleDecision(decision: "approve" | "deny"): Promise<void> {
    if (!userCode) {
      setError("Missing device code.");
      return;
    }

    setError("");
    setSubmitting(decision);

    try {
      if (decision === "approve") {
        await authClient.device.approve({ userCode });
      } else {
        await authClient.device.deny({ userCode });
      }

      router.replace(decision === "approve" ? "/items" : "/device");
    } catch {
      setError(
        decision === "approve"
          ? "Could not approve this device request."
          : "Could not deny this device request.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  if (!userCode) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
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
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
          <p className="text-sm text-muted-foreground">Checking your session...</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Device authorization request</h1>
          <p className="text-sm text-muted-foreground">
            A CLI is requesting access to your abadge account.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-lg border border-border px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            User code
          </div>
          <div className="mt-1 font-mono text-lg">{userCode}</div>
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
            disabled={submitting !== null}
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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
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

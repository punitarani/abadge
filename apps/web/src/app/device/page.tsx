"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthShell } from "@/components";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { authClient } from "@/lib/auth-client";

function normalizeUserCode(value: string): string {
  return value.trim().replace(/-/g, "").toUpperCase();
}

function DeviceAuthorizationPageContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userCode, setUserCode] = useState(normalizeUserCode(searchParams.get("user_code") ?? ""));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitCode(code: string): Promise<void> {
    const normalized = normalizeUserCode(code);
    if (normalized.length !== 8) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await authClient.device({
        query: { user_code: normalized },
      });
      if (!response.data) {
        setError("This code is invalid or expired.");
        return;
      }

      router.push(`/device/approve?user_code=${encodeURIComponent(normalized)}`);
    } catch {
      setError("This code is invalid or expired.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-submit when the page loads with a pre-filled code in the URL
  useEffect(() => {
    const initialCode = normalizeUserCode(searchParams.get("user_code") ?? "");
    if (initialCode.length !== 8) return;

    setError("");
    setLoading(true);
    authClient
      .device({ query: { user_code: initialCode } })
      .then((response: { data?: unknown }) => {
        if (!response.data) {
          setError("This code is invalid or expired.");
          return;
        }
        router.push(`/device/approve?user_code=${encodeURIComponent(initialCode)}`);
      })
      .catch(() => setError("This code is invalid or expired."))
      .finally(() => setLoading(false));
  }, [router, searchParams]);

  function handleChange(value: string): void {
    const normalized = normalizeUserCode(value);
    setUserCode(normalized);
    setError("");
    if (normalized.length === 8) {
      void submitCode(normalized);
    }
  }

  return (
    <AuthShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
          <p className="text-sm text-muted-foreground">
            Enter the 8-character code shown in your terminal.
          </p>
        </div>

        <div className="space-y-6">
          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-4">
            <InputOTP
              maxLength={8}
              value={userCode}
              onChange={handleChange}
              disabled={loading}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
                <InputOTPSlot index={6} />
                <InputOTPSlot index={7} />
              </InputOTPGroup>
            </InputOTP>

            {loading ? (
              <p className="text-sm text-muted-foreground">Verifying...</p>
            ) : (
              <p className="text-xs text-muted-foreground">The code expires in a few minutes.</p>
            )}
          </div>
        </div>
      </div>
    </AuthShell>
  );
}

function DeviceAuthorizationFallback(): React.ReactElement {
  return (
    <AuthShell>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </AuthShell>
  );
}

export default function DeviceAuthorizationPage(): React.ReactElement {
  return (
    <Suspense fallback={<DeviceAuthorizationFallback />}>
      <DeviceAuthorizationPageContent />
    </Suspense>
  );
}

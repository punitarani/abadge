"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthShell } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function normalizeUserCode(value: string): string {
  return value.trim().replace(/-/g, "").toUpperCase();
}

function DeviceAuthorizationPageContent(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userCode, setUserCode] = useState(searchParams.get("user_code") ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const initialCode = searchParams.get("user_code");
    if (!initialCode) {
      return;
    }

    const normalized = normalizeUserCode(initialCode);
    void (async () => {
      try {
        const response = await authClient.device({
          query: { user_code: normalized },
        });
        if (response.data) {
          router.replace(`/device/approve?user_code=${encodeURIComponent(normalized)}`);
        }
      } catch {
        setError("This device code is invalid or expired.");
      }
    })();
  }, [router, searchParams]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const normalized = normalizeUserCode(userCode);
      const response = await authClient.device({
        query: { user_code: normalized },
      });
      if (!response.data) {
        setError("This device code is invalid or expired.");
        return;
      }

      router.push(`/device/approve?user_code=${encodeURIComponent(normalized)}`);
    } catch {
      setError("This device code is invalid or expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
          <p className="text-sm text-muted-foreground">
            Enter the code shown in your CLI to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="device-code">User code</Label>
            <Input
              id="device-code"
              autoFocus
              autoCapitalize="characters"
              maxLength={12}
              placeholder="ABCD-1234"
              value={userCode}
              onChange={(event) => setUserCode(event.target.value)}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Validating..." : "Continue"}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}

function DeviceAuthorizationFallback(): React.ReactElement {
  return (
    <AuthShell>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Authorize device</h1>
        <p className="text-sm text-muted-foreground">Loading device authorization...</p>
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

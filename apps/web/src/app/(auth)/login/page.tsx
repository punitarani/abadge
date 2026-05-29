"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthShell, SocialAuthButtons } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SocialProvider } from "@/lib/auth-client";
import { authClient, SOCIAL_PROVIDERS } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/auth-error-message";
import { normalizeRedirectPath } from "@/lib/redirect";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const redirectPath = normalizeRedirectPath(searchParams.get("redirect"));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = getAuthErrorMessage(params);
    if (authError) {
      // Email-verification failures (e.g. expired token) land here with
      // ?verified=1&error=<code>; show the error, not the success banner.
      setError(authError);
    } else if (params.get("verified") === "1") {
      setVerified(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message ?? "Sign in failed");
      } else {
        router.push(redirectPath);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleSocialSignIn(provider: SocialProvider) {
    setError("");
    setSocialLoading(provider);

    try {
      const currentURL = new URL(window.location.href);
      const { error: socialError } = await authClient.signIn.social({
        provider,
        callbackURL: `${currentURL.origin}${redirectPath}`,
        errorCallbackURL: `${currentURL.origin}${currentURL.pathname}`,
      });

      if (socialError) {
        setError(socialError.message ?? `Could not start ${provider} sign-in`);
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setSocialLoading(null);
    }
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Enter your credentials to access your vault.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {verified && !error && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Email verified. Sign in to continue.
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || socialLoading !== null}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <SocialAuthButtons
          providers={SOCIAL_PROVIDERS}
          loadingProvider={socialLoading}
          onProviderClick={handleSocialSignIn}
        />

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href={
              redirectPath !== "/items"
                ? `/register?redirect=${encodeURIComponent(redirectPath)}`
                : "/register"
            }
            className="font-medium text-foreground hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

function LoginPageFallback(): React.ReactElement {
  return (
    <AuthShell>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Loading sign-in options...</p>
      </div>
    </AuthShell>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageContent />
    </Suspense>
  );
}

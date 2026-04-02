"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell, SocialAuthButtons } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SocialProvider } from "@/lib/auth-client";
import { authClient, SOCIAL_PROVIDERS } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/auth-error-message";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);

  useEffect(() => {
    const authError = getAuthErrorMessage(new URLSearchParams(window.location.search));
    if (authError) {
      setError(authError);
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
        router.push("/items");
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
        callbackURL: `${currentURL.origin}/items`,
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
          <Link href="/register" className="font-medium text-foreground hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

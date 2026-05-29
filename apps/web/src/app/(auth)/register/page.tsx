"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthShell, SocialAuthButtons } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/password-strength";
import type { SocialProvider } from "@/lib/auth-client";
import { authClient, SOCIAL_PROVIDERS } from "@/lib/auth-client";
import { getAuthErrorMessage } from "@/lib/auth-error-message";
import { normalizeRedirectPath } from "@/lib/redirect";

function CheckInboxView({ email }: { email: string }): React.ReactElement {
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleResend() {
    setResendState("sending");
    try {
      const { error } = await authClient.sendVerificationEmail({ email });
      setResendState(error ? "error" : "sent");
    } catch {
      setResendState("error");
    }
  }

  return (
    <AuthShell>
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted p-4">
            <Mail className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
          <p className="text-sm text-muted-foreground">
            Click the link to verify your account, then sign in.
          </p>
        </div>

        <div className="space-y-3">
          {resendState === "sent" ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Verification email resent. Check your inbox.
            </div>
          ) : resendState === "error" ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Could not resend. Try again in a moment.
            </div>
          ) : null}

          <Button
            variant="outline"
            className="w-full"
            onClick={handleResend}
            disabled={resendState === "sending" || resendState === "sent"}
          >
            {resendState === "sending" ? "Sending..." : "Resend verification email"}
          </Button>

          <Link
            href="/login"
            className="block text-center text-sm font-medium text-foreground hover:underline"
          >
            Back to sign in
          </Link>
        </div>

        <p className="text-sm text-muted-foreground">
          Wrong email?{" "}
          <Link href="/register" className="font-medium text-foreground hover:underline">
            Start over
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

function RegisterPageContent() {
  const searchParams = useSearchParams();
  const redirectPath = normalizeRedirectPath(searchParams.get("redirect"), "/onboarding");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  useEffect(() => {
    const authError = getAuthErrorMessage(new URLSearchParams(window.location.search));
    if (authError) {
      setError(authError);
    }
  }, []);

  if (registeredEmail) {
    return <CheckInboxView email={registeredEmail} />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const { error: signUpError } = await authClient.signUp.email({
        name,
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message ?? "Registration failed");
      } else {
        setRegisteredEmail(email);
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
          <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
          <p className="text-sm text-muted-foreground">Start managing your credentials securely.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password (min. 12 chars)</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Min 12 characters"
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <PasswordStrength password={password} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || socialLoading !== null}>
            {loading ? "Creating account..." : "Create account"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            By creating an account, you agree to the{" "}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </form>

        <SocialAuthButtons
          providers={SOCIAL_PROVIDERS}
          loadingProvider={socialLoading}
          onProviderClick={handleSocialSignIn}
        />

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export default function RegisterPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </AuthShell>
      }
    >
      <RegisterPageContent />
    </Suspense>
  );
}

"use client";

import {
  DEFAULT_KDF_PARAMS,
  deriveKEK,
  generateRootKey,
  generateSalt,
  toBase64,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/password-strength";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

const STEPS = [{ label: "Organization" }, { label: "Internal profile" }];

function toSlugPreview(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Derives a KEK from the password, generates a root key, wraps it, and bootstraps the profile. */
async function bootstrapZkProfile(profileId: string, password: string): Promise<void> {
  const salt = generateSalt();
  const kek = deriveKEK(password, salt, DEFAULT_KDF_PARAMS);
  const rootKey = generateRootKey();
  const wrapped = wrapRootKey(rootKey, kek);

  try {
    await browserTrpcClient.profiles.bootstrap.mutate({
      profileId,
      wrappedRootKey: wrapped.wrapped,
      kdfSalt: toBase64(salt),
      kdfParams: DEFAULT_KDF_PARAMS,
    });
  } finally {
    zeroKey(kek);
    zeroKey(rootKey);
  }
}

function validateStep2Input(
  profileName: string,
  storageMode: string,
  vaultPassword: string,
  confirmPassword: string,
): string | null {
  if (!profileName.trim()) {
    return "Profile name is required";
  }
  if (storageMode === "zero_knowledge") {
    if (vaultPassword.length < 12) {
      return "Vault password must be at least 12 characters";
    }
    if (vaultPassword !== confirmPassword) {
      return "Passwords do not match";
    }
  }
  return null;
}

export default function OnboardingPage(): React.ReactElement {
  const router = useRouter();
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  // Step management
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 state
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgSlugFinal, setOrgSlugFinal] = useState("");

  // Step 2 state
  const [profileName, setProfileName] = useState("internal");
  const [storageMode, setStorageMode] = useState<"zero_knowledge" | "server_managed">(
    "zero_knowledge",
  );
  const [vaultPassword, setVaultPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleOrgNameChange(value: string): void {
    setOrgName(value);
    setOrgSlug(toSlugPreview(value));
  }

  async function handleStep1Submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

    if (!orgName.trim()) {
      setError("Organization name is required");
      return;
    }

    setLoading(true);
    try {
      const result = await browserTrpcClient.organizations.create.mutate({
        name: orgName.trim(),
      });

      const org = result.organization;
      setActiveOrg({ id: org.id, slug: org.slug, name: org.name });
      setOrgId(org.id);
      setOrgSlugFinal(org.slug);
      setCurrentStep(1);
    } catch (err) {
      setError(getClientErrorMessage(err, "Failed to create organization"));
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2Submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

    const validationError = validateStep2Input(
      profileName,
      storageMode,
      vaultPassword,
      confirmPassword,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const profileResult = await browserTrpcClient.profiles.create.mutate({
        orgId,
        name: profileName.trim(),
        storageMode,
      });

      if (storageMode === "zero_knowledge") {
        await bootstrapZkProfile(profileResult.profile.id, vaultPassword);
      }

      toast.success("Profile created successfully");
      router.push(`/${orgSlugFinal}/overview`);
    } catch (err) {
      setError(getClientErrorMessage(err, "Failed to create profile"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 sm:px-8">
        {/* Header */}
        <header className="flex h-20 items-center">
          <Link href="/" className="inline-flex items-center gap-1.5">
            <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
            <span className="text-xl font-bold tracking-[-0.04em] text-foreground">abadge</span>
          </Link>
        </header>

        {/* Main */}
        <main className="flex flex-1 flex-col items-center py-12 sm:py-16">
          <div className="w-full max-w-lg space-y-8">
            {/* Progress */}
            <ProgressSteps steps={STEPS} currentStep={currentStep} />

            {/* Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
              {currentStep === 0 && (
                <form onSubmit={handleStep1Submit} className="space-y-6">
                  <div className="space-y-1">
                    <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                      Step 1 of 2
                    </p>
                    <h1 className="text-xl font-semibold tracking-tight">Name your organization</h1>
                    <p className="text-sm text-muted-foreground">
                      Your organization is the top-level boundary for all secrets, profiles, and
                      agents. You are the custodian — you manage secrets on behalf of your users.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="org-name">Organization name</Label>
                      <Input
                        id="org-name"
                        type="text"
                        placeholder="Acme Corp"
                        value={orgName}
                        onChange={(e) => handleOrgNameChange(e.target.value)}
                        required
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground">
                        Displayed in the dashboard and billing.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="org-slug">Organization slug</Label>
                      <div className="flex items-center">
                        <span className="flex h-9 items-center rounded-l-lg border border-r-0 border-border bg-muted px-3 text-sm text-muted-foreground">
                          api.abadge.io/
                        </span>
                        <Input
                          id="org-slug"
                          type="text"
                          value={orgSlug}
                          className="rounded-l-none"
                          disabled
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Kebab-case (lowercase, numbers, hyphens). Used in API paths — choose a
                        stable name you won't change.
                      </p>
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating..." : "Continue →"}
                  </Button>
                </form>
              )}

              {currentStep === 1 && (
                <form onSubmit={handleStep2Submit} className="space-y-6">
                  <div className="space-y-1">
                    <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                      Step 2 of 2
                    </p>
                    <h1 className="text-xl font-semibold tracking-tight">
                      Set up your internal profile
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      This is your organization's own operational vault for shared secrets like
                      deploy keys and CI credentials. You'll create additional profiles for each
                      user or customer whose secrets you manage.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="profile-name">
                        Profile name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="profile-name"
                        type="text"
                        placeholder="internal"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Must be kebab-case (lowercase letters, numbers, hyphens). Unique per org.
                        Used in API paths — choose a stable name.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Storage mode <span className="text-red-500">*</span>
                      </Label>

                      <button
                        type="button"
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                          storageMode === "zero_knowledge"
                            ? "border-foreground bg-foreground/[0.02]"
                            : "border-border hover:border-foreground/30"
                        }`}
                        onClick={() => setStorageMode("zero_knowledge")}
                      >
                        <div
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            storageMode === "zero_knowledge"
                              ? "border-foreground"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {storageMode === "zero_knowledge" && (
                            <div className="h-2 w-2 rounded-full bg-foreground" />
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-sm font-medium">Zero-knowledge</span>
                          <p className="text-xs text-muted-foreground">
                            Items are encrypted client-side. The server never sees plaintext or your
                            root key.
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`flex w-full cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                          storageMode === "server_managed"
                            ? "border-foreground bg-foreground/[0.02]"
                            : "border-border hover:border-foreground/30"
                        }`}
                        onClick={() => setStorageMode("server_managed")}
                      >
                        <div
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            storageMode === "server_managed"
                              ? "border-foreground"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {storageMode === "server_managed" && (
                            <div className="h-2 w-2 rounded-full bg-foreground" />
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-sm font-medium">Server-managed</span>
                          <p className="text-xs text-muted-foreground">
                            Items are encrypted server-side with AES-256-GCM. Simpler setup, no
                            client-side crypto.
                          </p>
                        </div>
                      </button>
                    </div>

                    {storageMode === "zero_knowledge" && (
                      <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                        <div className="flex items-center gap-2 text-amber-700">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                          >
                            <path
                              d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 5v3.5m0 2h.007"
                              stroke="currentColor"
                              strokeWidth="1.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className="text-sm font-medium">
                            The server will never see this password
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="vault-password">
                            Vault password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="vault-password"
                            type="password"
                            value={vaultPassword}
                            onChange={(e) => setVaultPassword(e.target.value)}
                            placeholder="Min 12 characters"
                            minLength={12}
                            required={storageMode === "zero_knowledge"}
                          />
                          <PasswordStrength password={vaultPassword} />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="vault-confirm-password">
                            Confirm password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="vault-confirm-password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Repeat password"
                            required={storageMode === "zero_knowledge"}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating profile..." : "Create profile & go to dashboard"}
                  </Button>

                  <p className="text-xs text-muted-foreground">
                    You'll add more profiles for each user or entity whose secrets you manage — one
                    profile per user, each with its own encryption boundary and agent access
                    controls.
                  </p>
                </form>
              )}
            </div>

            {/* Footer links */}
            {currentStep === 0 && (
              <div className="space-y-3 text-center">
                <p className="text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link href="/login" className="font-medium text-foreground hover:underline">
                    Sign in
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground">
                  By continuing, you agree to the{" "}
                  <Link href="/terms" className="underline hover:text-foreground">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="underline hover:text-foreground">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

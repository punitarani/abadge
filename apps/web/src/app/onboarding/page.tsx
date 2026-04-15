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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/password-strength";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { authClient } from "@/lib/auth-client";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";
import { StorageModePicker } from "@/components/onboarding/storage-mode-picker";
import { decideOnboardingStateFromList, type ListedOrg } from "./onboarding-triage";
import { resolveOrCreateProfile } from "./resolve-profile";

const STEPS = [{ label: "Organization" }, { label: "Internal profile" }];

function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(seed)}`;
}

type SlugStatus = "idle" | "checking" | "available" | "taken";

function SlugStatusIndicator({ status }: { status: SlugStatus }): React.ReactElement | null {
  if (status === "checking") {
    return <span className="shrink-0 text-xs text-muted-foreground">Checking...</span>;
  }
  if (status === "available") {
    return <span className="shrink-0 text-xs text-emerald-600">Available</span>;
  }
  if (status === "taken") {
    return <span className="shrink-0 text-xs text-red-600">Taken</span>;
  }
  return null;
}

function useSlugStatus(slug: string): SlugStatus {
  const [status, setStatus] = useState<SlugStatus>("idle");

  useEffect(() => {
    if (!slug || slug.length < 2) {
      setStatus("idle");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setStatus("idle");
      return;
    }
    setStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const result = await browserTrpcClient.organizations.checkSlug.query({ slug });
        setStatus(result.available ? "available" : "taken");
      } catch {
        setStatus("idle");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [slug]);

  return status;
}

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
  profilePassword: string,
  confirmPassword: string,
): string | null {
  if (!profileName.trim()) {
    return "Profile name is required";
  }
  if (storageMode === "zero_knowledge") {
    if (profilePassword.length < 12) {
      return "Profile password must be at least 12 characters";
    }
    if (profilePassword !== confirmPassword) {
      return "Passwords do not match";
    }
  }
  return null;
}

interface Step1Params {
  orgName: string;
  orgSlug: string;
  slugStatus: SlugStatus;
  setActiveOrg: (org: { id: string; slug: string; name: string; logo: string | null }) => void;
  setOrgId: (id: string) => void;
  setCurrentStep: (step: number) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
}

async function submitStep1({
  orgName,
  orgSlug,
  slugStatus,
  setActiveOrg,
  setOrgId,
  setCurrentStep,
  setLoading,
  setError,
}: Step1Params): Promise<void> {
  if (!orgName.trim()) {
    setError("Organization name is required");
    return;
  }
  if (slugStatus === "taken") {
    setError("This slug is already taken. Choose a different one.");
    return;
  }
  setLoading(true);
  try {
    const result = await browserTrpcClient.organizations.create.mutate({
      name: orgName.trim(),
      slug: orgSlug || undefined,
      logo: orgSlug ? dicebearUrl(orgSlug) : undefined,
    });
    const org = result.organization;

    // If no custom slug was provided, the server generated one — update the logo with the canonical slug
    if (!orgSlug && !org.logo) {
      const logoUrl = dicebearUrl(org.slug);
      await browserTrpcClient.organizations.update.mutate({
        orgId: org.id,
        logo: logoUrl,
      });
      org.logo = logoUrl;
    }

    setActiveOrg({ id: org.id, slug: org.slug, name: org.name, logo: org.logo ?? null });
    setOrgId(org.id);
    setCurrentStep(1);
  } catch (err) {
    setError(getClientErrorMessage(err, "Failed to create organization"));
  } finally {
    setLoading(false);
  }
}

interface Step2Params {
  orgId: string;
  profileName: string;
  storageMode: "zero_knowledge" | "server_managed";
  profilePassword: string;
  confirmPassword: string;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
  onSuccess: () => void;
}

async function submitStep2({
  orgId,
  profileName,
  storageMode,
  profilePassword,
  confirmPassword,
  setLoading,
  setError,
  onSuccess,
}: Step2Params): Promise<void> {
  const validationError = validateStep2Input(
    profileName,
    storageMode,
    profilePassword,
    confirmPassword,
  );
  if (validationError) {
    setError(validationError);
    return;
  }
  setLoading(true);
  try {
    const profileId = await resolveOrCreateProfile(browserTrpcClient, {
      orgId,
      name: profileName.trim(),
      storageMode,
    });
    // If bootstrap fails after the profile row is created, delete the orphan so
    // the user can retry onboarding with the same profile name. Rollback errors
    // are swallowed (logged only) — the original bootstrap error still surfaces
    // to the UI.
    // Test harness is in place (apps/web/bunfig.toml + happy-dom), but a full
    // rollback test requires mocking the tRPC client against the React tree;
    // the pure helper resolveOrCreateProfile is covered by resolve-profile.test.ts.
    try {
      if (storageMode === "zero_knowledge") {
        await bootstrapZkProfile(profileId, profilePassword);
      }
    } catch (bootstrapErr) {
      await browserTrpcClient.profiles.delete
        .mutate({ profileId })
        .catch((rollbackErr: unknown) => {
          console.warn("[onboarding] Failed to rollback unbootstrapped profile:", rollbackErr);
        });
      throw bootstrapErr;
    }
    toast.success("Profile created successfully");
    onSuccess();
  } catch (err) {
    setError(getClientErrorMessage(err, "Failed to create profile"));
  } finally {
    setLoading(false);
  }
}

export default function OnboardingPage(): React.ReactElement | null {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  // Stable primitive: Better Auth's useSession() can return a fresh object
  // reference per render. Depending on session.user.id keeps effects from
  // re-firing (and redoing organizations.list + per-org profiles.list) on
  // unrelated renders.
  const userId = session?.user?.id ?? null;
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);

  // Step management
  const [currentStep, setCurrentStep] = useState(0);

  // Tracks the resume-triage mount effect so we don't flash step 1 while we
  // decide whether the user should resume step 2 or redirect to overview.
  const [isCheckingOrgs, setIsCheckingOrgs] = useState(true);

  // Step 1 state
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const slugStatus = useSlugStatus(orgSlug);
  const [orgId, setOrgId] = useState("");

  // Step 2 state
  const [profileName, setProfileName] = useState("internal");
  const [storageMode, setStorageMode] = useState<"zero_knowledge" | "server_managed">(
    "zero_knowledge",
  );
  const [profilePassword, setProfilePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleOrgNameChange(value: string): void {
    setOrgName(value);
    if (!slugEdited) {
      setOrgSlug(toSlugPreview(value));
    }
  }

  function handleSlugChange(value: string): void {
    setSlugEdited(true);
    // Intentional: toSlugPreview normalizes input (lowercases, strips invalid chars).
    // This is correct for a slug field — the user sees their input auto-corrected.
    setOrgSlug(toSlugPreview(value));
  }

  async function handleStep1Submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    await submitStep1({
      orgName,
      orgSlug,
      slugStatus,
      setActiveOrg,
      setOrgId,
      setCurrentStep,
      setLoading,
      setError,
    });
  }

  async function handleStep2Submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    await submitStep2({
      orgId,
      profileName,
      storageMode,
      profilePassword,
      confirmPassword,
      setLoading,
      setError,
      onSuccess: () => {
        // Belt-and-suspenders: clear profile password state on success.
        // Paired with the unmount cleanup below (B17) and the autoComplete
        // attributes on the inputs. We deliberately do NOT clear on error —
        // the user may want to retry without retyping.
        setProfilePassword("");
        setConfirmPassword("");
        router.push("/overview");
      },
    });
  }

  // Auth guard — unauthenticated visitors shouldn't see the create-org form.
  // Redirect happens in an effect to avoid side-effects during render.
  useEffect(() => {
    if (!sessionPending && !userId) {
      router.replace("/login?redirect=/onboarding");
    }
  }, [sessionPending, userId, router]);

  // B17: tear-down clearing of profile password state on unmount. Complements
  // B5's success-path clear. Defense-in-depth only — React state "clearing"
  // drops the reference but the old string may linger until GC. True zeroing
  // would require Uint8Array-backed inputs (out of scope for MVP).
  useEffect(() => {
    return () => {
      setProfilePassword("");
      setConfirmPassword("");
    };
  }, []);

  // Resume-triage: if the user abandoned onboarding (tab close after org
  // create but before profile bootstrap), skip straight to step 2 for that
  // org. If they are fully onboarded, redirect to /overview. If they have no
  // orgs, fall through to step 1.
  useEffect(() => {
    if (sessionPending || !userId) return;

    let cancelled = false;
    (async () => {
      try {
        const listResult = await browserTrpcClient.organizations.list.query();
        if (cancelled) return;

        const summaries: ListedOrg[] = listResult.organizations ?? [];
        if (summaries.length === 0) {
          setIsCheckingOrgs(false);
          return;
        }

        // Single round trip: organizations.list now carries hasBootstrappedProfile
        // per row, so the previous N+1 profiles.list-per-org chain is gone.
        const decision = decideOnboardingStateFromList(summaries);
        if (decision.step === "redirect") {
          router.replace("/overview");
          return;
        }
        if (decision.step === "step2") {
          const logo = summaries.find((s) => s.id === decision.orgId)?.logo ?? null;
          setActiveOrg({
            id: decision.orgId,
            slug: decision.orgSlug,
            name: decision.orgName,
            logo,
          });
          setOrgId(decision.orgId);
          setOrgName(decision.orgName);
          setOrgSlug(decision.orgSlug);
          setCurrentStep(1);
        }
        setIsCheckingOrgs(false);
      } catch (err) {
        // If the resume probe fails (network, auth race, etc.), fall through
        // to step 1. Users can still create a new org; we just won't auto-resume.
        console.warn("[onboarding] Failed to detect existing org state:", err);
        if (!cancelled) setIsCheckingOrgs(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionPending, userId, router, setActiveOrg]);

  if (sessionPending || !session?.user || isCheckingOrgs) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
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
                      <div className="flex items-center gap-2">
                        <Input
                          id="org-slug"
                          type="text"
                          value={orgSlug}
                          onChange={(e) => handleSlugChange(e.target.value)}
                          placeholder="acme-corp"
                          className="font-mono text-sm"
                        />
                        <SlugStatusIndicator status={slugStatus} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Lowercase letters, numbers, and hyphens. Auto-generated from the name — edit
                        to customize.
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

                    <StorageModePicker value={storageMode} onChange={setStorageMode} />

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
                          <Label htmlFor="profile-password">
                            Profile password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="profile-password"
                            type="password"
                            // B17: non-login-looking name + new-password hint keep the browser's
                            // credential manager from offering to save a password the server
                            // never sees. `autoComplete="off"` is ignored by most modern browsers
                            // on password fields; `new-password` is the standards-blessed hint.
                            name="abadge-profile-password"
                            autoComplete="new-password"
                            value={profilePassword}
                            onChange={(e) => setProfilePassword(e.target.value)}
                            placeholder="Min 12 characters"
                            minLength={12}
                            required={storageMode === "zero_knowledge"}
                          />
                          <PasswordStrength password={profilePassword} />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="profile-confirm-password">
                            Confirm password <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="profile-confirm-password"
                            type="password"
                            // B17: see companion comment on the profile-password input above.
                            name="abadge-profile-password-confirm"
                            autoComplete="new-password"
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

            {/* Footer links — TOS moved to /register. This page is post-signup. */}
            {currentStep === 0 && (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <Link href="/login" className="font-medium text-foreground hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StorageModePicker } from "@/components/onboarding/storage-mode-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/password-strength";
import { ProgressSteps } from "@/components/ui/progress-steps";
import { authClient } from "@/lib/auth-client";
import { bootstrapZkProfile, resolveOrCreateProfile } from "@/lib/profile-bootstrap";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

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
  userId: string | null;
  orgName: string;
  orgSlug: string;
  slugStatus: SlugStatus;
  setActiveOrg: (
    userId: string,
    org: { id: string; slug: string; name: string; logo: string | null },
  ) => void;
  setOrgId: (id: string) => void;
  setCurrentStep: (step: number) => void;
  setLoading: (v: boolean) => void;
  setError: (v: string) => void;
}

async function submitStep1({
  userId,
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
  if (slugStatus === "checking") {
    setError("Slug availability is still being checked. Please wait a moment.");
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

    // Both call sites (/onboarding and the dashboard org-switcher) gate the
    // form on an authenticated session, so userId is non-null in practice.
    // Skip the store update on the defensive null branch rather than seeding
    // lastUserId with a placeholder — the dashboard's session-user-change
    // guard will re-resolve the active org from server truth.
    if (userId) {
      setActiveOrg(userId, { id: org.id, slug: org.slug, name: org.name, logo: org.logo ?? null });
    }
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
    // the user can retry with the same profile name. Rollback errors are
    // swallowed (logged only) — the original bootstrap error still surfaces.
    try {
      if (storageMode === "zero_knowledge") {
        await bootstrapZkProfile(profileId, profilePassword);
      }
    } catch (bootstrapErr) {
      await browserTrpcClient.profiles.delete
        .mutate({ profileId })
        .catch((rollbackErr: unknown) => {
          console.warn("[create-org] Failed to rollback unbootstrapped profile:", rollbackErr);
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

export interface CreateOrgFormSuccess {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
}

export interface CreateOrgFormProps {
  /**
   * Called after the internal profile is bootstrapped. Receives the new org.
   * If omitted, the form leaves redirection up to the caller.
   */
  onSuccess?: (result: CreateOrgFormSuccess) => void;
  /**
   * Card: standalone layout for pages (used by /onboarding).
   * Dialog: compact layout for modal dialogs that provide their own chrome.
   */
  variant?: "card" | "dialog";
  /**
   * Optional initial state for resuming a partial onboarding (e.g. when the
   * user closed the tab after step 1). The onboarding page sets this from the
   * resume-triage probe.
   */
  initialOrg?: {
    orgId: string;
    orgName: string;
    orgSlug: string;
    step: 0 | 1;
  };
  /**
   * Render a "Back" affordance above step 1. The onboarding page passes this
   * to return to the choose screen; the dialog variant doesn't need it.
   */
  onBack?: () => void;
}

/**
 * Reusable two-step org-creation form. Two entry points render this:
 *   - /onboarding (mode === "create"): the choose-then-create flow for new users.
 *   - dashboard org-switcher ("+ Create organization…" dialog): adds another org.
 *
 * Keeping them on one component prevents drift: any change to the server
 * endpoints, validation, or success behavior applies everywhere at once.
 */
export function CreateOrgForm({
  onSuccess,
  variant = "card",
  initialOrg,
  onBack,
}: CreateOrgFormProps): React.ReactElement {
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState<number>(initialOrg?.step ?? 0);

  // Step 1 state
  const [orgName, setOrgName] = useState(initialOrg?.orgName ?? "");
  const [orgSlug, setOrgSlug] = useState(initialOrg?.orgSlug ?? "");
  const [slugEdited, setSlugEdited] = useState(false);
  const slugStatus = useSlugStatus(orgSlug);
  const [orgId, setOrgId] = useState(initialOrg?.orgId ?? "");

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
    setOrgSlug(toSlugPreview(value));
  }

  async function handleStep1Submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    await submitStep1({
      userId,
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
        // Clear sensitive state on the success path; the unmount cleanup below
        // is a belt-and-suspenders for cancellation.
        setProfilePassword("");
        setConfirmPassword("");
        // Refresh the org list so the switcher and dashboard pick up the new
        // org without a hard reload.
        void queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.organizations(),
        });
        onSuccess?.({
          organizationId: orgId,
          organizationSlug: orgSlug,
          organizationName: orgName,
        });
      },
    });
  }

  // Tear-down: clear profile password state on unmount. Defense-in-depth only;
  // React state "clearing" drops the reference but the old string may linger
  // until GC. Real zeroing would require Uint8Array-backed inputs.
  useEffect(() => {
    return () => {
      setProfilePassword("");
      setConfirmPassword("");
    };
  }, []);

  function handleBackToStep1(): void {
    // Clear ALL org-creation state on Back. Without this reset, a user who
    // completed step 1 (org row already inserted) and clicks Back would call
    // organizations.create a second time, leaving the first org permanently
    // without a profile. If the user did create a partial org and abandons it,
    // the next /onboarding visit's resume-triage recovers it.
    setCurrentStep(0);
    setError("");
    setOrgId("");
    setOrgName("");
    setOrgSlug("");
    setSlugEdited(false);
    onBack?.();
  }

  const cardClass =
    variant === "dialog"
      ? "space-y-5"
      : "rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8";

  const showBackButton = variant === "card" && onBack && currentStep === 0;

  return (
    <div className="space-y-5">
      {showBackButton && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBackToStep1}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        </div>
      )}

      <ProgressSteps steps={STEPS} currentStep={currentStep} />

      <div className={cardClass}>
        {currentStep === 0 && (
          <form onSubmit={handleStep1Submit} className="space-y-6">
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Step 1 of 2
              </p>
              <h2 className="text-xl font-semibold tracking-tight">Name your organization</h2>
              <p className="text-sm text-muted-foreground">
                Your organization is the top-level boundary for all secrets, profiles, and agents.
                You are the custodian — you manage secrets on behalf of your users.
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
                  Lowercase letters, numbers, and hyphens. Auto-generated from the name — edit to
                  customize.
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
              <h2 className="text-xl font-semibold tracking-tight">Set up your internal profile</h2>
              <p className="text-sm text-muted-foreground">
                This is your organization's own operational vault for shared secrets like deploy
                keys and CI credentials. You'll create additional profiles for each user or customer
                whose secrets you manage.
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
                  Must be kebab-case (lowercase letters, numbers, hyphens). Unique per org. Used in
                  API paths — choose a stable name.
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
                      // Non-login-looking name + new-password hint so the browser's
                      // credential manager doesn't offer to save a password the server never sees.
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
              {loading ? "Creating profile..." : "Create profile & continue"}
            </Button>

            <p className="text-xs text-muted-foreground">
              You'll add more profiles for each user or entity whose secrets you manage — one
              profile per user, each with its own encryption boundary and agent access controls.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

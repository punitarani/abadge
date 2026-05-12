"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

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

export interface CreateOrgFormSuccess {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
}

export interface CreateOrgFormProps {
  /**
   * Called after the org is created. Receives the new org details.
   * If omitted, the form leaves redirection up to the caller.
   */
  onSuccess?: (result: CreateOrgFormSuccess) => void;
  /**
   * Card: standalone layout for pages (used by /onboarding).
   * Dialog: compact layout for modal dialogs that provide their own chrome.
   */
  variant?: "card" | "dialog";
  /**
   * Render a "Back" affordance above the form. The onboarding page passes
   * this to return to the choose screen; the dialog variant doesn't need it.
   */
  onBack?: () => void;
}

/**
 * §REVAMP-PR5 (Task 9.1) — Single-step org creation.
 *
 * `organizations.create` auto-provisions a default `server_managed`
 * profile in the same transaction (PR3), so the form no longer needs a
 * second step to bootstrap a profile. Additional profiles — including
 * zero-knowledge ones with their own KDF/password — are created from
 * the profiles page after onboarding.
 *
 * Two entry points render this:
 *   - /onboarding (mode === "create"): fresh-signup flow.
 *   - dashboard org-switcher "+ Create organization" dialog.
 */
export function CreateOrgForm({
  onSuccess,
  variant = "card",
  onBack,
}: CreateOrgFormProps): React.ReactElement {
  const setActiveOrg = useOrgStore((s) => s.setActiveOrg);
  const queryClient = useQueryClient();

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const slugStatus = useSlugStatus(orgSlug);

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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pre-submit validation, slug-status gating, and the post-create logo fix-up are co-located so the create-org happy path reads top-to-bottom.
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

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

      // If no custom slug was provided, the server generated one — update
      // the logo with the canonical slug.
      if (!orgSlug && !org.logo) {
        const logoUrl = dicebearUrl(org.slug);
        await browserTrpcClient.organizations.update.mutate({
          orgId: org.id,
          logo: logoUrl,
        });
        org.logo = logoUrl;
      }

      setActiveOrg({ id: org.id, slug: org.slug, name: org.name, logo: org.logo ?? null });
      toast.success(`Organization "${org.name}" created.`);

      // Refresh the org list so the dashboard switcher picks up the new
      // org without a hard reload.
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.organizations(),
      });

      onSuccess?.({
        organizationId: org.id,
        organizationSlug: org.slug,
        organizationName: org.name,
      });
    } catch (err) {
      setError(getClientErrorMessage(err, "Failed to create organization"));
    } finally {
      setLoading(false);
    }
  }

  const cardClass =
    variant === "dialog"
      ? "space-y-5"
      : "rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8";

  const showBackButton = variant === "card" && onBack;

  return (
    <div className="space-y-5">
      {showBackButton && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onBack?.()}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
        </div>
      )}

      <div className={cardClass}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Name your organization</h2>
            <p className="text-sm text-muted-foreground">
              Your organization is the top-level boundary for all secrets, profiles, and agents. A
              default profile is created automatically so you can start storing secrets right away.
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
            {loading ? "Creating organization..." : "Create organization"}
          </Button>

          <p className="text-xs text-muted-foreground">
            You can add more profiles (per customer, per environment, or zero-knowledge profiles
            with their own password) from the profiles page after onboarding.
          </p>
        </form>
      </div>
    </div>
  );
}

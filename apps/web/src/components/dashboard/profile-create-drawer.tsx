"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordStrength } from "@/components/ui/password-strength";
import { bootstrapZkProfile, resolveOrCreateProfile } from "@/lib/profile-bootstrap";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";

type StorageMode = "zero_knowledge" | "server_managed";

export interface ProfileCreateDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
}

/**
 * §REVAMP-PR5 (Task 9.2) — Profile create form.
 *
 * Default storage mode is `server_managed`; the operator opts into
 * zero-knowledge with an "advanced" toggle. The ZK code path is the
 * same as before: derive a KEK from a profile password, encrypt a fresh
 * root key client-side, and call `profiles.bootstrap` with the
 * wrapped key.
 *
 * External ID is optional. It's surfaced because per-customer or
 * per-tenant provisioning often wants a stable identifier the API
 * caller controls.
 */
export function ProfileCreateDrawer({
  open,
  onOpenChange,
  orgId,
}: ProfileCreateDrawerProps): React.ReactElement {
  const queryClient = useQueryClient();
  const formId = useId();

  const [profileName, setProfileName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [zkEnabled, setZkEnabled] = useState(false);
  const [profilePassword, setProfilePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const storageMode: StorageMode = zkEnabled ? "zero_knowledge" : "server_managed";

  function resetForm(): void {
    setProfileName("");
    setExternalId("");
    setZkEnabled(false);
    setProfilePassword("");
    setConfirmPassword("");
    setError("");
  }

  function handleClose(): void {
    resetForm();
    onOpenChange(false);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation, ZK bootstrap, and orphan rollback are intentionally co-located so the failure paths are obvious in one read.
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

    if (!profileName.trim()) {
      setError("Profile name is required");
      return;
    }
    if (storageMode === "zero_knowledge") {
      if (profilePassword.length < 12) {
        setError("Profile password must be at least 12 characters");
        return;
      }
      if (profilePassword !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    setLoading(true);
    try {
      const profileId = await resolveOrCreateProfile(browserTrpcClient, {
        orgId,
        name: profileName.trim(),
        storageMode,
        externalId: externalId.trim() || undefined,
      });

      // If bootstrap fails after the profile row is created, delete the orphan
      // so the user can retry with the same profile name. Rollback errors are
      // swallowed (logged only) — the original bootstrap error still surfaces.
      try {
        if (storageMode === "zero_knowledge") {
          await bootstrapZkProfile(profileId, profilePassword);
        }
      } catch (bootstrapErr) {
        await browserTrpcClient.profiles.delete
          .mutate({ profileId })
          .catch((rollbackErr: unknown) => {
            console.warn(
              "[profile-create-drawer] Failed to rollback unbootstrapped profile:",
              rollbackErr,
            );
          });
        throw bootstrapErr;
      }

      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.profiles(orgId),
      });
      toast.success("Profile created.");
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError(getClientErrorMessage(err, "Failed to create profile"));
    } finally {
      setLoading(false);
    }
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={loading}>
        Cancel
      </Button>
      <Button form={formId} type="submit" disabled={loading}>
        {loading ? "Creating..." : zkEnabled ? "Encrypt & save" : "Create profile"}
      </Button>
    </div>
  );

  const content = (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="drawer-profile-name">
          Profile name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="drawer-profile-name"
          type="text"
          placeholder="customer-a"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          required
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Must be kebab-case (lowercase letters, numbers, hyphens). Unique per org.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="drawer-profile-external-id">External ID (optional)</Label>
        <Input
          id="drawer-profile-external-id"
          type="text"
          placeholder="cust_acme_001"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          A stable identifier your system controls (per-customer, per-tenant). Unique within the org
          when set; leave blank if you don't need one.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm">
        <input
          type="checkbox"
          checked={zkEnabled}
          onChange={(e) => setZkEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer"
        />
        <div className="space-y-0.5">
          <div className="font-medium">Zero-knowledge encryption (advanced)</div>
          <p className="text-xs text-muted-foreground">
            The server stores only ciphertext. You set a profile password that the server never
            sees. Required for secrets you don't trust the server to read. Default is server-managed
            AES-256-GCM.
          </p>
        </div>
      </label>

      {zkEnabled && (
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
            <span className="text-sm font-medium">The server will never see this password</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-profile-password">
              Profile password <span className="text-red-500">*</span>
            </Label>
            <Input
              id="drawer-profile-password"
              type="password"
              name="abadge-profile-password"
              autoComplete="new-password"
              value={profilePassword}
              onChange={(e) => setProfilePassword(e.target.value)}
              placeholder="Min 12 characters"
              minLength={12}
              required={zkEnabled}
            />
            <PasswordStrength password={profilePassword} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="drawer-profile-confirm-password">
              Confirm password <span className="text-red-500">*</span>
            </Label>
            <Input
              id="drawer-profile-confirm-password"
              type="password"
              name="abadge-profile-password-confirm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              required={zkEnabled}
            />
          </div>
        </div>
      )}
    </form>
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
      title="New profile"
      description="Create a credential namespace within your organization."
      footer={footer}
    >
      {content}
    </ResponsiveOverlay>
  );
}

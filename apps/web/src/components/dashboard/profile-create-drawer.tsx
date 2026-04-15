"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { StorageModePicker } from "@/components/onboarding/storage-mode-picker";
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

export function ProfileCreateDrawer({
  open,
  onOpenChange,
  orgId,
}: ProfileCreateDrawerProps): React.ReactElement {
  const queryClient = useQueryClient();
  const formId = useId();

  const [profileName, setProfileName] = useState("");
  const [storageMode, setStorageMode] = useState<StorageMode>("zero_knowledge");
  const [profilePassword, setProfilePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function resetForm(): void {
    setProfileName("");
    setStorageMode("zero_knowledge");
    setProfilePassword("");
    setConfirmPassword("");
    setError("");
  }

  function handleClose(): void {
    resetForm();
    onOpenChange(false);
  }

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
        {loading
          ? "Creating..."
          : storageMode === "zero_knowledge"
            ? "Encrypt & save"
            : "Create profile"}
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
              required={storageMode === "zero_knowledge"}
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
              required={storageMode === "zero_knowledge"}
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

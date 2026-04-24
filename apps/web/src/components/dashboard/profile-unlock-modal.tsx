"use client";

import type { KDFParams } from "@abadge/crypto";
import { deriveKEK, unwrapRootKey, zeroKey } from "@abadge/crypto";
import { Eye, EyeSlash, LockSimple, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserTrpcClient } from "@/lib/trpc-browser";

interface ProfileUnlockModalProps {
  profileId: string;
  profileName: string;
  orgName: string;
  open: boolean;
  onClose: () => void;
  onSuccess: (rootKey: Uint8Array) => void;
}

function decodeSalt(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

export function ProfileUnlockModal({
  profileId,
  profileName,
  orgName,
  open,
  onClose,
  onSuccess,
}: ProfileUnlockModalProps): React.ReactElement {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await browserTrpcClient.profiles.get.query({ profileId });
      const profile = result.profile;

      if (!profile.wrappedRootKey || !profile.kdfSalt || !profile.kdfParams) {
        setError("This profile has not been bootstrapped yet. Set up its profile password first.");
        return;
      }

      const salt = decodeSalt(profile.kdfSalt);
      const kek = deriveKEK(password, salt, profile.kdfParams as KDFParams);

      try {
        // §W1S7-001 — AAD binds to (profileId, keyVersion); stale wraps or
        // cross-profile wraps fail the AEAD tag check and surface as a
        // password error below.
        const rootKey = unwrapRootKey({ wrapped: profile.wrappedRootKey }, kek, {
          profileId,
          keyVersion: profile.keyVersion,
        });
        zeroKey(kek);
        setPassword("");
        onSuccess(rootKey);
      } catch {
        zeroKey(kek);
        setError("Incorrect profile password.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock profile");
    } finally {
      setLoading(false);
    }
  }

  function handleClose(): void {
    setPassword("");
    setError("");
    setShowPassword(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <LockSimple className="h-5 w-5 text-muted-foreground" />
            <DialogTitle>Unlock {profileName}</DialogTitle>
          </div>
          <DialogDescription>
            Enter your profile password to decrypt this profile.
          </DialogDescription>
        </DialogHeader>

        {/* Security callout */}
        <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/30">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-xs text-emerald-800 dark:text-emerald-300">
            Your profile password never leaves this device. It derives a local key used to decrypt
            the profile root key — no password is transmitted to abadge servers.
          </p>
        </div>

        {/* Profile info card */}
        <div className="rounded-md bg-muted/50 px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Profile</span>
            <span className="font-medium">{profileName}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Storage</span>
            <Badge variant="secondary">zero_knowledge</Badge>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Organization</span>
            <span className="text-xs text-muted-foreground">{orgName}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="profile-unlock-password">Profile password</Label>
            <div className="relative">
              <Input
                id="profile-unlock-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the password you set when you first created this profile.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !password}>
              {loading ? "Unlocking..." : "Unlock profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

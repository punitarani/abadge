"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { bootstrapVault, unlockVault } from "@/lib/crypto-client";

export default function SettingsPage(): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  async function handleChangePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setChanging(true);
    try {
      // Verify current password by unlocking
      await unlockVault(currentPassword);

      // Re-bootstrap with new password (re-wraps the root key)
      const result = await bootstrapVault(newPassword);
      setRecoveryKey(result.recoveryKey);
      setSuccess("Master password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your vault settings</p>
      </div>

      <div className="border border-border rounded-lg p-5 space-y-4">
        <div className="text-sm font-semibold">Change master password</div>
        <p className="text-sm text-muted-foreground">
          Changing your master password will re-wrap your root key. A new recovery key will be
          generated.
        </p>

        <form onSubmit={handleChangePassword} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {success}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="current-pw">Current master password</Label>
            <Input
              id="current-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New master password</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirm new password</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" size="sm" disabled={changing}>
            {changing ? "Changing..." : "Change password"}
          </Button>
        </form>
      </div>

      {recoveryKey && (
        <div className="border border-border rounded-lg p-5 space-y-4">
          <div className="text-sm font-semibold">New recovery key</div>
          <p className="text-sm text-muted-foreground">
            Your recovery key has been regenerated. Save it now.
          </p>

          <SecretDisplay value={recoveryKey} />

          <Button variant="outline" size="sm" onClick={() => setRecoveryKey(null)}>
            I have saved my recovery key
          </Button>
        </div>
      )}
    </div>
  );
}

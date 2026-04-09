"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { changePassword } from "@/lib/crypto-client";

export default function SettingsPage(): React.ReactElement {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  async function handleChangePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setChanging(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      setRecoveryKey(result.recoveryKey);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your vault configuration</p>
      </div>

      {/* Master password */}
      <section className="space-y-4">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-semibold">Master password</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your master password derives the key that protects all items in your vault. Changing it
            re-wraps your root key and issues a new recovery key.
          </p>
        </div>

        {recoveryKey ? (
          <div className="rounded-lg border border-border p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  Password changed — save your new recovery key
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  This key is the only way to recover your vault if you forget your password. It
                  will not be shown again.
                </p>
              </div>
            </div>
            <SecretDisplay value={recoveryKey} />
            <Button variant="outline" size="sm" onClick={() => setRecoveryKey(null)}>
              I have saved my recovery key
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleChangePassword}
            className="rounded-lg border border-border p-5 space-y-4"
          >
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-pw">Current master password</Label>
                <Input
                  id="current-pw"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
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
                  autoComplete="new-password"
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
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            <Button type="submit" size="sm" disabled={changing}>
              {changing ? "Changing..." : "Change password"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}

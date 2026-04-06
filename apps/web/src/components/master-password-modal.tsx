"use client";

import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretDisplay } from "@/components/ui/secret-display";
import { bootstrapVault, unlockVault } from "@/lib/crypto-client";

type ModalStep = "loading" | "unlock" | "bootstrap" | "recovery";

interface MasterPasswordModalProps {
  open: boolean;
  vaultExists: boolean | null;
  checkVaultExists: () => Promise<boolean>;
  onSuccess: (key: Uint8Array) => void;
  onCancel: () => void;
  onVaultExistsChange: (exists: boolean) => void;
}

export function MasterPasswordModal({
  open,
  vaultExists,
  checkVaultExists,
  onSuccess,
  onCancel,
  onVaultExistsChange,
}: MasterPasswordModalProps): React.ReactElement {
  const [step, setStep] = useState<ModalStep>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const pendingKeyRef = useRef<Uint8Array | null>(null);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return; // only initialize on false → true transition

    setPassword("");
    setConfirmPassword("");
    setError("");
    setRecoveryKey("");
    pendingKeyRef.current = null;

    if (vaultExists === true) {
      setStep("unlock");
    } else if (vaultExists === false) {
      setStep("bootstrap");
    } else {
      setStep("loading");
      checkVaultExists()
        .then((exists) => {
          onVaultExistsChange(exists);
          setStep(exists ? "unlock" : "bootstrap");
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to check vault");
          setStep("unlock");
        });
    }
  }, [open, vaultExists, checkVaultExists, onVaultExistsChange]);

  async function handleUnlock(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const key = await unlockVault(password);
      onSuccess(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock vault");
    } finally {
      setLoading(false);
    }
  }

  async function handleBootstrap(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Master password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { rootKey: key, recoveryKey: rk } = await bootstrapVault(password);
      onVaultExistsChange(true);
      pendingKeyRef.current = key;
      setRecoveryKey(rk);
      setStep("recovery");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bootstrap failed");
    } finally {
      setLoading(false);
    }
  }

  function handleRecoveryAcknowledged(): void {
    const key = pendingKeyRef.current;
    if (key) {
      pendingKeyRef.current = null;
      onSuccess(key);
    }
  }

  const preventClose = step === "bootstrap" || step === "recovery";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !preventClose) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none"
          onInteractOutside={(e) => {
            if (preventClose) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (preventClose) e.preventDefault();
          }}
        >
          {step === "loading" && (
            <div className="flex items-center justify-center py-4">
              <span className="text-sm text-muted-foreground">Checking vault...</span>
            </div>
          )}

          {step === "unlock" && (
            <div className="space-y-6">
              <div className="space-y-1">
                <Dialog.Title className="text-base font-semibold">Unlock vault</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Enter your master password to continue.
                </Dialog.Description>
              </div>
              <form onSubmit={handleUnlock} className="space-y-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="mp-modal-unlock">Master password</Label>
                  <Input
                    id="mp-modal-unlock"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={loading}>
                    {loading ? "Unlocking..." : "Unlock"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {step === "bootstrap" && (
            <div className="space-y-6">
              <div className="space-y-1">
                <Dialog.Title className="text-base font-semibold">Set up your vault</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Choose a master password to encrypt your vault. This password never leaves your
                  browser.
                </Dialog.Description>
              </div>
              <form onSubmit={handleBootstrap} className="space-y-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="mp-modal-new">Master password</Label>
                  <Input
                    id="mp-modal-new"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mp-modal-confirm">Confirm password</Label>
                  <Input
                    id="mp-modal-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" size="sm" disabled={loading}>
                  {loading ? "Creating vault..." : "Create vault"}
                </Button>
              </form>
            </div>
          )}

          {step === "recovery" && (
            <div className="space-y-6">
              <div className="space-y-1">
                <Dialog.Title className="text-base font-semibold">
                  Save your recovery key
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Store this key somewhere safe. It is the only way to recover your vault if you
                  forget your master password.
                </Dialog.Description>
              </div>
              <div className="space-y-4">
                <SecretDisplay value={recoveryKey} />
                <Button className="w-full" size="sm" onClick={handleRecoveryAcknowledged}>
                  I have saved my recovery key
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

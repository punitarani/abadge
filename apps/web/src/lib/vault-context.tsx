"use client";

import { zeroKey } from "@abadge/crypto";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { MasterPasswordModal } from "@/components/master-password-modal";
import { browserTrpcClient } from "./trpc-browser";

interface VaultContextValue {
  isUnlocked: boolean;
  rootKey: Uint8Array | null;
  /** null = unknown, true = exists, false = needs bootstrap */
  vaultExists: boolean | null;
  lockVault: () => void;
  checkVaultExists: () => Promise<boolean>;
  /** Request the root key, prompting for master password if needed. */
  requestUnlock: () => Promise<Uint8Array>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [rootKey, setRootKey] = useState<Uint8Array | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const pendingUnlock = useRef<{
    resolve: (key: Uint8Array) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const lockVault = useCallback((): void => {
    if (rootKey) {
      zeroKey(rootKey);
    }
    setRootKey(null);
  }, [rootKey]);

  const checkVaultExists = useCallback(async (): Promise<boolean> => {
    try {
      await browserTrpcClient.vault.get.query();
      setVaultExists(true);
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "data" in error &&
        typeof (error as { data?: { httpStatus?: number } }).data?.httpStatus === "number" &&
        (error as { data?: { httpStatus?: number } }).data?.httpStatus === 404
      ) {
        setVaultExists(false);
        return false;
      }

      throw error;
    }
  }, []);

  const requestUnlock = useCallback((): Promise<Uint8Array> => {
    if (rootKey !== null) {
      return Promise.resolve(rootKey);
    }
    // Reject any already-pending caller before overwriting the slot.
    if (pendingUnlock.current) {
      pendingUnlock.current.reject(new Error("Superseded by a newer unlock request"));
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      pendingUnlock.current = { resolve, reject };
      setModalOpen(true);
    });
  }, [rootKey]);

  const handleUnlockSuccess = useCallback((key: Uint8Array): void => {
    setRootKey(key);
    setModalOpen(false);
    pendingUnlock.current?.resolve(key);
    pendingUnlock.current = null;
  }, []);

  const handleModalCancel = useCallback((): void => {
    setModalOpen(false);
    pendingUnlock.current?.reject(new Error("User cancelled vault unlock"));
    pendingUnlock.current = null;
  }, []);

  const value = useMemo<VaultContextValue>(
    () => ({
      isUnlocked: rootKey !== null,
      rootKey,
      vaultExists,
      lockVault,
      checkVaultExists,
      requestUnlock,
    }),
    [rootKey, vaultExists, lockVault, checkVaultExists, requestUnlock],
  );

  return (
    <VaultContext.Provider value={value}>
      {children}
      <MasterPasswordModal
        open={modalOpen}
        vaultExists={vaultExists}
        checkVaultExists={checkVaultExists}
        onSuccess={handleUnlockSuccess}
        onCancel={handleModalCancel}
        onVaultExistsChange={setVaultExists}
      />
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return ctx;
}

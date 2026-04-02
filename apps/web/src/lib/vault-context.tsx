"use client";

import { zeroKey } from "@abadge/crypto";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  bootstrapVault as bootstrapVaultCrypto,
  unlockVault as unlockVaultCrypto,
} from "./crypto-client";
import { browserTrpcClient } from "./trpc-browser";

interface VaultContextValue {
  isUnlocked: boolean;
  rootKey: Uint8Array | null;
  /** null = unknown, true = exists, false = needs bootstrap */
  vaultExists: boolean | null;
  unlockVault: (masterPassword: string) => Promise<void>;
  lockVault: () => void;
  bootstrapVault: (masterPassword: string) => Promise<{ recoveryKey: string }>;
  checkVaultExists: () => Promise<boolean>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [rootKey, setRootKey] = useState<Uint8Array | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);

  const unlockVault = useCallback(async (masterPassword: string): Promise<void> => {
    const key = await unlockVaultCrypto(masterPassword);
    setRootKey(key);
  }, []);

  const lockVault = useCallback((): void => {
    if (rootKey) {
      zeroKey(rootKey);
    }
    setRootKey(null);
  }, [rootKey]);

  const bootstrapVault = useCallback(
    async (masterPassword: string): Promise<{ recoveryKey: string }> => {
      const { rootKey: key, recoveryKey } = await bootstrapVaultCrypto(masterPassword);
      setRootKey(key);
      setVaultExists(true);
      return { recoveryKey };
    },
    [],
  );

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

  const value = useMemo<VaultContextValue>(
    () => ({
      isUnlocked: rootKey !== null,
      rootKey,
      vaultExists,
      unlockVault,
      lockVault,
      bootstrapVault,
      checkVaultExists,
    }),
    [rootKey, vaultExists, unlockVault, lockVault, bootstrapVault, checkVaultExists],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return ctx;
}

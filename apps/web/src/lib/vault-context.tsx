"use client";

import { zeroKey } from "@abadge/crypto";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProfileUnlockModal } from "@/components/dashboard/profile-unlock-modal";
import { MasterPasswordModal } from "@/components/master-password-modal";
import { useOrgStore } from "@/stores/org-store";
import { browserTrpcClient } from "./trpc-browser";

/** Auto-lock timeout for per-profile keys (30 minutes). */
const PROFILE_KEY_TTL_MS = 30 * 60 * 1000;

interface VaultContextValue {
  /** Legacy: whether the default vault root key is held in memory. */
  isUnlocked: boolean;
  /** Legacy: the default vault root key. */
  rootKey: Uint8Array | null;
  /** null = unknown, true = exists, false = needs bootstrap */
  vaultExists: boolean | null;
  /** Legacy: lock the default vault key. */
  lockVault: () => void;
  checkVaultExists: () => Promise<boolean>;
  /**
   * Request the root key, prompting for master password if needed.
   * When called without profileId, shows the legacy MasterPasswordModal.
   * When called with profileId, shows the ProfileUnlockModal.
   */
  requestUnlock: (profileId?: string) => Promise<Uint8Array>;

  /* --- Per-profile key management --- */
  isProfileUnlocked: (profileId: string) => boolean;
  getProfileKey: (profileId: string) => Uint8Array | null;
  setProfileKey: (profileId: string, key: Uint8Array) => void;
  lockProfile: (profileId: string) => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const activeOrgName = useOrgStore((s) => s.activeOrgName);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);

  /* Legacy vault state */
  const [rootKey, setRootKey] = useState<Uint8Array | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [legacyModalOpen, setLegacyModalOpen] = useState(false);
  const pendingLegacyUnlock = useRef<{
    resolve: (key: Uint8Array) => void;
    reject: (err: Error) => void;
  } | null>(null);

  /* Per-profile key state */
  const [profileKeys, setProfileKeys] = useState<Map<string, Uint8Array>>(new Map());
  const profileTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /* Mirror of profileKeys for the unmount cleanup closure, which sees stale state otherwise. */
  const profileKeysRef = useRef<Map<string, Uint8Array>>(profileKeys);
  /* Mirror of the current root key for unmount zeroing without re-registering the cleanup. */
  const rootKeyRef = useRef<Uint8Array | null>(rootKey);
  useEffect(() => {
    profileKeysRef.current = profileKeys;
  }, [profileKeys]);
  useEffect(() => {
    rootKeyRef.current = rootKey;
  }, [rootKey]);

  /* Profile unlock modal state */
  const [profileUnlockTarget, setProfileUnlockTarget] = useState<{
    profileId: string;
    profileName: string;
    orgName: string;
  } | null>(null);
  const pendingProfileUnlock = useRef<{
    resolve: (key: Uint8Array) => void;
    reject: (err: Error) => void;
  } | null>(null);

  /*
   * Zero all in-memory key material on unmount.
   *
   * The explicit lockVault/lockProfile paths zero keys, but React teardown
   * (HMR/Fast Refresh, dashboard layout unmount on logout, route error
   * boundaries, page hide) can destroy the provider without invoking those
   * paths. This is the last-chance scrub. Reads from refs because the
   * cleanup closure captures stale state.
   */
  useEffect(() => {
    return () => {
      const keys = profileKeysRef.current;
      for (const key of keys.values()) {
        key.fill(0);
      }
      keys.clear();
      const rk = rootKeyRef.current;
      if (rk) {
        zeroKey(rk);
      }
      for (const timer of profileTimers.current.values()) {
        clearTimeout(timer);
      }
      profileTimers.current.clear();
    };
  }, []);

  /* ---- Timer helpers ---- */

  const resetProfileTimer = useCallback((profileId: string) => {
    const existing = profileTimers.current.get(profileId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      setProfileKeys((prev) => {
        const key = prev.get(profileId);
        if (key) key.fill(0);
        const next = new Map(prev);
        next.delete(profileId);
        return next;
      });
      profileTimers.current.delete(profileId);
    }, PROFILE_KEY_TTL_MS);

    profileTimers.current.set(profileId, timer);
  }, []);

  /* ---- Legacy vault ---- */

  const lockVault = useCallback((): void => {
    if (rootKey) {
      zeroKey(rootKey);
    }
    setRootKey(null);
    /* Also zero all profile keys */
    setProfileKeys((prev) => {
      for (const key of prev.values()) {
        key.fill(0);
      }
      return new Map();
    });
    for (const timer of profileTimers.current.values()) {
      clearTimeout(timer);
    }
    profileTimers.current.clear();
  }, [rootKey]);

  /*
   * Lock on org switch. Profile keys from the previous org are not reachable
   * through the UI anyway (all item lists are org-scoped), but leaving them
   * resident in JS memory violates the short-key-residency posture.
   *
   * Guarded by previousOrgId !== null to avoid running on initial mount,
   * where no keys are unlocked yet.
   */
  const previousOrgId = useRef<string | null>(null);
  useEffect(() => {
    if (previousOrgId.current !== null && previousOrgId.current !== activeOrgId) {
      lockVault();
    }
    previousOrgId.current = activeOrgId;
  }, [activeOrgId, lockVault]);

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

  /* ---- Per-profile key management ---- */

  const isProfileUnlocked = useCallback(
    (profileId: string): boolean => {
      return profileKeys.has(profileId);
    },
    [profileKeys],
  );

  const getProfileKey = useCallback(
    (profileId: string): Uint8Array | null => {
      const key = profileKeys.get(profileId) ?? null;
      if (key) {
        resetProfileTimer(profileId);
      }
      return key;
    },
    [profileKeys, resetProfileTimer],
  );

  const setProfileKey = useCallback(
    (profileId: string, key: Uint8Array): void => {
      setProfileKeys((prev) => {
        const next = new Map(prev);
        next.set(profileId, key);
        return next;
      });
      resetProfileTimer(profileId);
    },
    [resetProfileTimer],
  );

  const lockProfile = useCallback((profileId: string): void => {
    setProfileKeys((prev) => {
      const key = prev.get(profileId);
      if (key) key.fill(0);
      const next = new Map(prev);
      next.delete(profileId);
      return next;
    });
    const timer = profileTimers.current.get(profileId);
    if (timer) {
      clearTimeout(timer);
      profileTimers.current.delete(profileId);
    }
  }, []);

  /* ---- Unlock request ---- */

  const requestUnlock = useCallback(
    (profileId?: string): Promise<Uint8Array> => {
      /* Profile-specific unlock */
      if (profileId) {
        const existing = profileKeys.get(profileId);
        if (existing) {
          resetProfileTimer(profileId);
          return Promise.resolve(existing);
        }

        if (pendingProfileUnlock.current) {
          pendingProfileUnlock.current.reject(new Error("Superseded by a newer unlock request"));
        }

        return new Promise<Uint8Array>((resolve, reject) => {
          pendingProfileUnlock.current = { resolve, reject };
          /* Fetch profile metadata for the modal */
          browserTrpcClient.profiles.get
            .query({ profileId })
            .then((result) => {
              setProfileUnlockTarget({
                profileId,
                profileName: result.profile.name,
                orgName: activeOrgName ?? result.profile.organizationId,
              });
            })
            .catch((err) => {
              pendingProfileUnlock.current?.reject(
                err instanceof Error ? err : new Error("Failed to fetch profile"),
              );
              pendingProfileUnlock.current = null;
            });
        });
      }

      /* Legacy vault unlock */
      if (rootKey !== null) {
        return Promise.resolve(rootKey);
      }
      if (pendingLegacyUnlock.current) {
        pendingLegacyUnlock.current.reject(new Error("Superseded by a newer unlock request"));
      }
      return new Promise<Uint8Array>((resolve, reject) => {
        pendingLegacyUnlock.current = { resolve, reject };
        setLegacyModalOpen(true);
      });
    },
    [rootKey, profileKeys, resetProfileTimer, activeOrgName],
  );

  /* ---- Modal callbacks ---- */

  const handleLegacyUnlockSuccess = useCallback((key: Uint8Array): void => {
    setRootKey(key);
    setLegacyModalOpen(false);
    pendingLegacyUnlock.current?.resolve(key);
    pendingLegacyUnlock.current = null;
  }, []);

  const handleLegacyModalCancel = useCallback((): void => {
    setLegacyModalOpen(false);
    pendingLegacyUnlock.current?.reject(new Error("User cancelled vault unlock"));
    pendingLegacyUnlock.current = null;
  }, []);

  const handleProfileUnlockSuccess = useCallback(
    (key: Uint8Array): void => {
      const target = profileUnlockTarget;
      if (target) {
        setProfileKey(target.profileId, key);
      }
      setProfileUnlockTarget(null);
      pendingProfileUnlock.current?.resolve(key);
      pendingProfileUnlock.current = null;
    },
    [profileUnlockTarget, setProfileKey],
  );

  const handleProfileUnlockCancel = useCallback((): void => {
    setProfileUnlockTarget(null);
    pendingProfileUnlock.current?.reject(new Error("User cancelled profile unlock"));
    pendingProfileUnlock.current = null;
  }, []);

  const value = useMemo<VaultContextValue>(
    () => ({
      isUnlocked: rootKey !== null,
      rootKey,
      vaultExists,
      lockVault,
      checkVaultExists,
      requestUnlock,
      isProfileUnlocked,
      getProfileKey,
      setProfileKey,
      lockProfile,
    }),
    [
      rootKey,
      vaultExists,
      lockVault,
      checkVaultExists,
      requestUnlock,
      isProfileUnlocked,
      getProfileKey,
      setProfileKey,
      lockProfile,
    ],
  );

  return (
    <VaultContext.Provider value={value}>
      {children}
      <MasterPasswordModal
        open={legacyModalOpen}
        vaultExists={vaultExists}
        checkVaultExists={checkVaultExists}
        onSuccess={handleLegacyUnlockSuccess}
        onCancel={handleLegacyModalCancel}
        onVaultExistsChange={setVaultExists}
      />
      {profileUnlockTarget && (
        <ProfileUnlockModal
          profileId={profileUnlockTarget.profileId}
          profileName={profileUnlockTarget.profileName}
          orgName={profileUnlockTarget.orgName}
          open={true}
          onClose={handleProfileUnlockCancel}
          onSuccess={handleProfileUnlockSuccess}
        />
      )}
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

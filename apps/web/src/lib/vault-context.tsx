"use client";

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
import { useOrgStore } from "@/stores/org-store";
import { browserTrpcClient } from "./trpc-browser";

/** Auto-lock timeout for per-profile keys (30 minutes). */
const PROFILE_KEY_TTL_MS = 30 * 60 * 1000;

interface VaultContextValue {
  /**
   * Lock every per-profile key currently held in memory and clear any pending
   * unlock prompt. Used on logout, org switch, and the user-initiated "Lock"
   * action in the sidebar.
   */
  lockAll: () => void;
  /**
   * Request the root key for a specific profile, prompting for the master
   * password via {@link ProfileUnlockModal} if the key is not currently held.
   * Resolves with the unwrapped root key (re-armed against the auto-lock TTL).
   */
  requestUnlock: (profileId: string) => Promise<Uint8Array>;
  isProfileUnlocked: (profileId: string) => boolean;
  hasAnyUnlockedProfile: boolean;
  getProfileKey: (profileId: string) => Uint8Array | null;
  setProfileKey: (profileId: string, key: Uint8Array) => void;
  lockProfile: (profileId: string) => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const activeOrgName = useOrgStore((s) => s.activeOrgName);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);

  /* Per-profile key state */
  const [profileKeys, setProfileKeys] = useState<Map<string, Uint8Array>>(new Map());
  const profileTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /*
   * Mirror of profileKeys for the unmount cleanup closure, which sees stale
   * state otherwise. Updated atomically inside every state setter below so
   * the "ref mirrors state" invariant is enforced by the code rather than by
   * React's scheduler.
   */
  const profileKeysRef = useRef<Map<string, Uint8Array>>(profileKeys);

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
   * The explicit lockAll/lockProfile paths zero keys, but React teardown
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
        profileKeysRef.current = next;
        return next;
      });
      profileTimers.current.delete(profileId);
    }, PROFILE_KEY_TTL_MS);

    profileTimers.current.set(profileId, timer);
  }, []);

  const lockAll = useCallback((): void => {
    setProfileKeys((prev) => {
      for (const key of prev.values()) {
        key.fill(0);
      }
      const next = new Map<string, Uint8Array>();
      profileKeysRef.current = next;
      return next;
    });
    for (const timer of profileTimers.current.values()) {
      clearTimeout(timer);
    }
    profileTimers.current.clear();
    /*
     * Cancel any in-flight unlock prompt: the user explicitly locked while
     * the modal was open waiting for a password.
     */
    if (pendingProfileUnlock.current) {
      pendingProfileUnlock.current.reject(new Error("Vault locked"));
      pendingProfileUnlock.current = null;
    }
    setProfileUnlockTarget(null);
  }, []);

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
      lockAll();
    }
    previousOrgId.current = activeOrgId;
  }, [activeOrgId, lockAll]);

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
        profileKeysRef.current = next;
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
      profileKeysRef.current = next;
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
    (profileId: string): Promise<Uint8Array> => {
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
    },
    [profileKeys, resetProfileTimer, activeOrgName],
  );

  /* ---- Modal callbacks ---- */

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
      lockAll,
      requestUnlock,
      isProfileUnlocked,
      hasAnyUnlockedProfile: profileKeys.size > 0,
      getProfileKey,
      setProfileKey,
      lockProfile,
    }),
    [
      lockAll,
      requestUnlock,
      isProfileUnlocked,
      profileKeys,
      getProfileKey,
      setProfileKey,
      lockProfile,
    ],
  );

  return (
    <VaultContext.Provider value={value}>
      {children}
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

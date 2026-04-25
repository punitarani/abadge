/**
 * Pure helper for deciding whether an existing profile counts as
 * "bootstrapped" (usable). Kept free of React and network calls so it is
 * trivially testable.
 */

export interface TriageProfile {
  id: string;
  storageMode: "zero_knowledge" | "server_managed";
  wrappedRootKey: string | null;
}

/**
 * A profile is considered "bootstrapped" (usable) when:
 * - it is server_managed (no client-side key needed), OR
 * - it is zero_knowledge and has a wrappedRootKey set.
 *
 * Mirrors the server-side gate in
 * `packages/trpc/src/server/onboarding-gate.ts`; they must stay in sync.
 *
 * Used by `resolve-profile.ts` to decide whether an "already exists"
 * profile is an unbootstrapped orphan we may adopt, or a real profile we
 * must never clobber.
 */
export function isProfileBootstrapped(p: TriageProfile): boolean {
  if (p.storageMode === "server_managed") return true;
  return p.wrappedRootKey !== null;
}
